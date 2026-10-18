import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WorkBuddyCredentialStore, type WorkBuddyCredential, type WorkBuddyRefreshOutcome } from '../src/auth.ts'
import { CN_VARIANT, AI_VARIANT, type WorkBuddyVariant } from '../src/variants.ts'

async function workspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'pi-workbuddy-test-'))
}

/** A store bound to one temp agent dir; the auth file comes from the env var. */
function storeFor(options: {
  dir: string
  refresh?: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome>
  variant?: WorkBuddyVariant
}): WorkBuddyCredentialStore {
  return new WorkBuddyCredentialStore({
    variant: options.variant ?? CN_VARIANT,
    ownDir: options.dir,
    refresh: options.refresh ?? (async () => ({ accessToken: 'refreshed' })),
  })
}

function desktopDocument(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    auth: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: Date.now() + 3_600_000,
      domain: 'www.workbuddy.cn',
    },
    account: { uid: 'account-1' },
    ...overrides,
  })
}

test('an absent auth file yields a signed-out status with the expected path', async () => {
  const dir = await workspace()
  const missing = join(dir, 'missing', CN_VARIANT.desktopFilename)
  process.env[CN_VARIANT.authFileEnv] = missing
  try {
    const store = storeFor({ dir })
    const status = await store.status()
    assert.equal(status.state, 'signed-out')
    await assert.rejects(store.resolve(), /no signed-in WorkBuddy account/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('a fresh desktop credential is used verbatim and never rewritten', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await writeFile(authFile, desktopDocument())
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({ dir })
    const credential = await store.resolve()
    assert.equal(credential.accessToken, 'access-1')
    assert.equal(credential.source, 'desktop')
    await assert.rejects(readFile(join(dir, CN_VARIANT.ownFilename), 'utf8'), /ENOENT/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('an expired credential is refreshed once and stored in the plugin copy', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'old', refreshToken: 'refresh-1', expiresAt: 1_000, domain: 'www.workbuddy.cn' },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  let calls = 0
  try {
    const store = storeFor({
      dir,
      refresh: async () => {
        calls += 1
        return { accessToken: 'new-token', refreshToken: 'refresh-2', expiresInSec: 3600 }
      },
    })
    const [first, second] = await Promise.all([store.resolve(), store.resolve()])
    assert.equal(calls, 1, 'parallel resolutions share one refresh')
    assert.equal(first.accessToken, 'new-token')
    assert.equal(second.accessToken, 'new-token')

    const own = JSON.parse(await readFile(join(dir, CN_VARIANT.ownFilename), 'utf8'))
    assert.equal(own.credential.accessToken, 'new-token')
    assert.equal(own.credential.refreshToken, 'refresh-2')
    // The app's file is never written.
    assert.match(await readFile(authFile, 'utf8'), /"accessToken":"old"/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed refresh still returns a token that has not expired', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  // Inside the refresh margin, but still valid for minutes.
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'still-good', refreshToken: 'refresh-1', expiresAt: Date.now() + 120_000, domain: 'www.workbuddy.cn' },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({
      dir,
      refresh: async () => {
        throw new Error('upstream down')
      },
    })
    assert.equal((await store.resolve()).accessToken, 'still-good')
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed refresh on an expired token reports how to recover', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'dead', refreshToken: 'refresh-1', expiresAt: 1_000, domain: 'www.workbuddy.cn' },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({
      dir,
      refresh: async () => {
        throw new Error('upstream down')
      },
    })
    await assert.rejects(store.resolve(), /open WorkBuddy once to sign in again/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('a newer plugin copy wins for the same account', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'desktop', refreshToken: 'r', expiresAt: 2_000, domain: 'www.workbuddy.cn' },
  }))
  await writeFile(join(dir, CN_VARIANT.ownFilename), JSON.stringify({
    version: 1,
    credential: {
      accessToken: 'own',
      refreshToken: 'r2',
      expiresAtMs: Date.now() + 3_600_000,
      domain: 'www.workbuddy.cn',
      uid: 'account-1',
      source: 'own',
    },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({ dir })
    assert.equal((await store.resolve()).accessToken, 'own')
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('the app file wins after an account switch, even if the copy expires later', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'new-account', refreshToken: 'r', expiresAt: Date.now() + 600_000, domain: 'www.workbuddy.cn' },
    account: { uid: 'account-2' },
  }))
  await writeFile(join(dir, CN_VARIANT.ownFilename), JSON.stringify({
    version: 1,
    credential: {
      accessToken: 'old-account',
      refreshToken: 'r2',
      expiresAtMs: Date.now() + 86_400_000,
      domain: 'www.workbuddy.cn',
      uid: 'account-1',
      source: 'own',
    },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const credential = await storeFor({ dir }).resolve()
    assert.equal(credential.accessToken, 'new-account')
    assert.equal(credential.uid, 'account-2')
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('a credential from the other product is refused, naming the file', async () => {
  const dir = await workspace()
  const authFile = join(dir, AI_VARIANT.desktopFilename)
  // The international app's file handed to the CN provider.
  await writeFile(authFile, desktopDocument({
    auth: { accessToken: 'global', refreshToken: 'r', expiresAt: Date.now() + 600_000, domain: 'www.workbuddy.ai' },
  }))
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({ dir })
    await assert.rejects(store.resolve(), /WorkBuddy AI credential in its desktop file/u)
    const status = await store.status()
    assert.equal(status.state, 'signed-out')
    assert.match(status.reason ?? '', /www\.workbuddy\.ai/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('an explicit auth-file env var is used verbatim', async () => {
  const dir = await workspace()
  const authFile = join(dir, 'elsewhere.json')
  await writeFile(authFile, desktopDocument())
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({ dir })
    assert.deepEqual(store.desktopCandidates(), [authFile])
    assert.equal((await store.current())?.accessToken, 'access-1')
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable auth file reports a diagnosis instead of silently signing out', async () => {
  const dir = await workspace()
  const authFile = join(dir, CN_VARIANT.desktopFilename)
  await mkdir(join(dir, 'nested'), { recursive: true })
  await writeFile(authFile, '{"auth":{"accessToken":{"$wbEncrypted":1,"envelope":"broken"}}}')
  process.env[CN_VARIANT.authFileEnv] = authFile
  try {
    const store = storeFor({ dir })
    await assert.rejects(store.resolve(), /exists but is unreadable/u)
  } finally {
    delete process.env[CN_VARIANT.authFileEnv]
    await rm(dir, { recursive: true, force: true })
  }
})
