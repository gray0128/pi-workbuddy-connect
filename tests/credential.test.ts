import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import {
  buildAuthenticatedContextAad,
  classifyDesktopAuthDocument,
  openAuthField,
  parseAtRestPayload,
} from '../src/desktop-credential.ts'
import { parseWorkBuddyAuth } from '../src/auth.ts'

/** Seal one field the way WorkBuddy 5.6 writes it, for a round-trip test. */
function seal(key: Buffer, plaintext: string): { $wbEncrypted: 1; envelope: string } {
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
  cipher.setAAD(buildAuthenticatedContextAad(keyId, 1))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const inner = {
    suite: 1,
    keyId,
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  return { $wbEncrypted: 1, envelope: Buffer.from(JSON.stringify(inner), 'utf8').toString('base64') }
}

test('plaintext documents classify as plaintext', () => {
  const text = JSON.stringify({ auth: { accessToken: 'token', domain: 'www.workbuddy.cn' }, account: { uid: 'u' } })
  assert.equal(classifyDesktopAuthDocument(text).format, 'plaintext')
})

test('empty documents classify as absent', () => {
  assert.equal(classifyDesktopAuthDocument('').format, 'absent')
  assert.equal(classifyDesktopAuthDocument('   \n').format, 'absent')
})

test('encrypted documents expose their wrapped fields and round-trip', () => {
  const key = randomBytes(32)
  const document = {
    auth: {
      accessToken: seal(key, 'access-plain'),
      refreshToken: seal(key, 'refresh-plain'),
      domain: 'www.workbuddy.cn',
      expiresAt: 1_800_000_000_000,
    },
    account: { uid: 'account-1', nickname: 'someone' },
  }
  const classification = classifyDesktopAuthDocument(JSON.stringify(document))
  assert.equal(classification.format, 'encrypted')
  if (classification.format !== 'encrypted') return
  assert.deepEqual(classification.fields.map(field => field.field), ['accessToken', 'refreshToken'])
  for (const field of classification.fields) {
    const plaintext = openAuthField(key, field.envelope)
    assert.equal(plaintext, field.field === 'accessToken' ? 'access-plain' : 'refresh-plain')
  }
})

test('a wrong key fails to open, it does not return garbage', () => {
  const document = { auth: { accessToken: seal(randomBytes(32), 'access-plain') } }
  const classification = classifyDesktopAuthDocument(JSON.stringify(document))
  assert.equal(classification.format, 'encrypted')
  if (classification.format !== 'encrypted') return
  assert.equal(openAuthField(randomBytes(32), classification.fields[0]!.envelope), undefined)
})

test('a wrapper claiming encryption with an undecodable envelope is unrecognized', () => {
  const text = JSON.stringify({ auth: { accessToken: { $wbEncrypted: 1, envelope: 'not-base64-json' } } })
  assert.equal(classifyDesktopAuthDocument(text).format, 'unrecognized')
})

test('an unsupported suite is unrecognized, never guessed at', () => {
  const key = randomBytes(32)
  const wrapped = seal(key, 'access-plain')
  const inner = JSON.parse(Buffer.from(wrapped.envelope, 'base64').toString('utf8'))
  inner.suite = 2
  const text = JSON.stringify({
    auth: { accessToken: { $wbEncrypted: 1, envelope: Buffer.from(JSON.stringify(inner)).toString('base64') } },
  })
  assert.equal(classifyDesktopAuthDocument(text).format, 'unrecognized')
})

test('the at-rest payload is validated: version, length, canonical base64', () => {
  const secret = randomBytes(32).toString('base64')
  assert.deepEqual(parseAtRestPayload(JSON.stringify({ version: 1, atRestSecretKey: secret })), { atRestSecretKey: secret })
  assert.equal(parseAtRestPayload(JSON.stringify({ version: 2, atRestSecretKey: secret })), undefined)
  assert.equal(parseAtRestPayload(JSON.stringify({ version: 1, atRestSecretKey: 'short' })), undefined)
  assert.equal(parseAtRestPayload(JSON.stringify({ version: 1, atRestSecretKey: Buffer.alloc(32).toString('base64') })), undefined)
  assert.equal(parseAtRestPayload('nonsense'), undefined)
})

test('the plaintext parser reads both on-disk shapes', () => {
  const nested = parseWorkBuddyAuth(JSON.stringify({
    auth: { accessToken: 'a', refreshToken: 'r', expiresAt: 1_700_000_000_000, domain: 'www.workbuddy.cn' },
    account: { uid: 'u1', nickname: 'nick', enterpriseId: 'e1' },
  }))
  assert.deepEqual(nested, {
    accessToken: 'a',
    refreshToken: 'r',
    expiresAtMs: 1_700_000_000_000,
    domain: 'www.workbuddy.cn',
    uid: 'u1',
    enterpriseId: 'e1',
    nickname: 'nick',
    source: 'desktop',
  })

  const flat = parseWorkBuddyAuth(JSON.stringify({ accessToken: 'a', expiresAt: 1_700_000_000, domain: '' }))
  assert.equal(flat?.expiresAtMs, 1_700_000_000_000)
  assert.equal(flat?.uid, '')
})

test('a document without an access token parses to undefined', () => {
  assert.equal(parseWorkBuddyAuth(JSON.stringify({ auth: { refreshToken: 'r' } })), undefined)
  assert.equal(parseWorkBuddyAuth('not json'), undefined)
})
