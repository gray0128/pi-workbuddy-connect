/**
 * WorkBuddy credential resolution.
 *
 * The primary source is the desktop app's own auth file, read-only. A
 * plugin-owned copy under the agent dir holds token refreshes, so the app's
 * file is never written. The effective credential is whichever of the two
 * expires later *for the same account*: after an account switch in the app the
 * copy belongs to the previous account, so a differing identity always yields
 * the app's file.
 *
 * @module pi-workbuddy-connect/auth
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  classifyDesktopAuthDocument,
  unwrapDesktopAuthDocument,
  WorkBuddyCredentialError,
} from './desktop-credential.ts'
import { regionOf, type WorkBuddyVariant } from './variants.ts'

/** Normalized credential, timestamps in epoch milliseconds. */
export interface WorkBuddyCredential {
  accessToken: string
  refreshToken: string
  expiresAtMs: number
  domain: string
  uid: string
  enterpriseId?: string
  nickname?: string
  /** Which storage the credential was read from; refreshes are always `own`. */
  source: 'desktop' | 'own'
}

/** Read-only sign-in summary for the status command. */
export interface WorkBuddyAuthStatus {
  state: 'signed-in' | 'signed-out'
  expiresAtMs?: number
  nickname?: string
  domain?: string
  source?: 'desktop' | 'own'
  /** Why no credential is usable, when the reason is diagnosable. */
  reason?: string
}

/** What a refresh call reported back. */
export interface WorkBuddyRefreshOutcome {
  accessToken: string
  refreshToken?: string
  expiresInSec?: number
  domain?: string
}

/** Where the app keeps its auth file, per platform, before the basename swap. */
function authDirectories(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth')]
  }
  if (process.platform === 'win32') {
    return [
      join(home, 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
      join(home, 'AppData', 'Roaming', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
    ]
  }
  const configHome = process.env['XDG_CONFIG_HOME']?.trim()
  const dataHome = process.env['XDG_DATA_HOME']?.trim()
  return [
    join(configHome !== undefined && configHome.startsWith('/') ? configHome : join(home, '.config'),
      'CodeBuddyExtension', 'Data', 'Public', 'auth'),
    join(dataHome !== undefined && dataHome.startsWith('/') ? dataHome : join(home, '.local', 'share'),
      'CodeBuddyExtension', 'Data', 'Public', 'auth'),
  ]
}

/** Platform-default auth-file candidates for one variant, in probe order. */
export function desktopAuthCandidates(variant: WorkBuddyVariant): string[] {
  return [...new Set(authDirectories().map(dir => join(dir, variant.desktopFilename)))]
}

/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs(value: number): number {
  if (value <= 0) return 0
  return value > 1e12 ? value : value * 1000
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Parse an auth document in either on-disk shape: the nested form
 * `{"auth": {...}, "account": {...}}` and the flat panel form. Returns
 * undefined when the document carries no access token.
 */
export function parseWorkBuddyAuth(text: string): WorkBuddyCredential | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const document = parsed as Record<string, unknown>
  const nested = typeof document['auth'] === 'object' && document['auth'] !== null
  const auth = (nested ? document['auth'] : document) as Record<string, unknown>
  const identity = nested && typeof document['account'] === 'object' && document['account'] !== null
    ? document['account'] as Record<string, unknown>
    : document
  const accessToken = typeof auth['accessToken'] === 'string' ? auth['accessToken'] : ''
  if (accessToken === '') return undefined
  const enterpriseId = optionalString(identity['enterpriseId'])
  const nickname = optionalString(identity['nickname'])
  return {
    accessToken,
    refreshToken: typeof auth['refreshToken'] === 'string' ? auth['refreshToken'] : '',
    expiresAtMs: typeof auth['expiresAt'] === 'number' ? expiryToMs(auth['expiresAt']) : 0,
    domain: optionalString(auth['domain']) ?? '',
    uid: optionalString(identity['uid']) ?? '',
    ...enterpriseId === undefined ? {} : { enterpriseId },
    ...nickname === undefined ? {} : { nickname },
    source: 'desktop',
  }
}

/** Serialize the plugin-owned copy. */
function ownDocument(credential: WorkBuddyCredential): string {
  return `${JSON.stringify({ version: 1, credential: { ...credential, source: 'own' } }, null, 2)}\n`
}

/** Parse the plugin-owned copy; other versions and shapes are rejected. */
function parseOwnDocument(text: string): WorkBuddyCredential | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const document = parsed as Record<string, unknown>
  if (document['version'] !== 1) return undefined
  const stored = document['credential']
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return undefined
  const record = stored as Record<string, unknown>
  const accessToken = typeof record['accessToken'] === 'string' ? record['accessToken'] : ''
  if (accessToken === '') return undefined
  const enterpriseId = optionalString(record['enterpriseId'])
  const nickname = optionalString(record['nickname'])
  return {
    accessToken,
    refreshToken: typeof record['refreshToken'] === 'string' ? record['refreshToken'] : '',
    expiresAtMs: typeof record['expiresAtMs'] === 'number' ? record['expiresAtMs'] : 0,
    domain: optionalString(record['domain']) ?? '',
    uid: optionalString(record['uid']) ?? '',
    ...enterpriseId === undefined ? {} : { enterpriseId },
    ...nickname === undefined ? {} : { nickname },
    source: 'own',
  }
}

/** Write a file atomically through a sibling temp file and a rename. */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temp, text, { mode: 0o600 })
  await rename(temp, path)
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Constructor dependencies; every filesystem seam is injectable for tests. */
export interface WorkBuddyCredentialStoreOptions {
  variant: WorkBuddyVariant
  /** Performs the upstream token refresh. */
  refresh: (credential: WorkBuddyCredential) => Promise<WorkBuddyRefreshOutcome>
  /** Directory holding the plugin-owned copy. */
  ownDir: string
  /** Refresh this long before actual expiry; default five minutes. */
  refreshMarginMs?: number
}

/**
 * Read-only credential store with demand-driven refresh.
 *
 * Refresh policy: refresh only when the access token is inside the margin (or
 * already expired), keep the refreshed credential in the plugin-owned copy,
 * and never write the app's file. A failed refresh still returns a
 * not-yet-expired token, so an unreachable refresh endpoint does not take down
 * a working session.
 */
export class WorkBuddyCredentialStore {
  private readonly variant: WorkBuddyVariant
  private readonly refresh: WorkBuddyCredentialStoreOptions['refresh']
  private readonly ownPath: string
  private readonly refreshMarginMs: number
  private inflight: Promise<WorkBuddyCredential> | undefined

  constructor(options: WorkBuddyCredentialStoreOptions) {
    this.variant = options.variant
    this.refresh = options.refresh
    this.ownPath = join(options.ownDir, options.variant.ownFilename)
    this.refreshMarginMs = options.refreshMarginMs ?? 5 * 60 * 1000
  }

  /** The app's auth-file candidates, as configured or platform-default. */
  desktopCandidates(): string[] {
    const fromEnv = process.env[this.variant.authFileEnv]?.trim()
    if (fromEnv !== undefined && fromEnv !== '') return [fromEnv]
    return desktopAuthCandidates(this.variant)
  }

  /**
   * Read the freshest stored credential without refreshing.
   *
   * A credential belonging to the other product is refused rather than used:
   * both apps share one auth directory and differ only by filename, so a
   * misconfigured env var is a realistic mistake, and sending one region's
   * token to the other's endpoint would leak it across products.
   */
  async current(): Promise<WorkBuddyCredential | undefined> {
    const own = await this.readOwn()
    // The app's file outranks the copy when both exist and disagree: a
    // differing identity means the copy is stale after an account switch.
    const desktop = await this.readDesktop()
    for (const [label, credential] of [['desktop file', desktop], ['plugin copy', own]] as const) {
      if (credential === undefined) continue
      const region = regionOf(credential.domain)
      if (region !== this.variant.region) {
        throw new WorkBuddyCredentialError(
          `${this.variant.displayName} received a ${region === 'cn' ? 'WorkBuddy (CN)' : 'WorkBuddy AI'}`
          + ` credential in its ${label} (domain ${JSON.stringify(credential.domain)});`
          + ` point ${this.variant.authFileEnv} at the ${this.variant.appName} sign-in`,
        )
      }
    }
    if (desktop === undefined) return own
    if (own === undefined) return desktop
    if (desktop.uid !== own.uid || desktop.enterpriseId !== own.enterpriseId) return desktop
    return own.expiresAtMs > desktop.expiresAtMs ? own : desktop
  }

  /** The credential to send upstream: {@link current}, refreshed on demand. */
  async resolve(): Promise<WorkBuddyCredential> {
    const credential = await this.current()
    if (credential === undefined) {
      const candidates = this.desktopCandidates()
      throw new WorkBuddyCredentialError(
        `no signed-in ${this.variant.appName} account found; sign in once in the`
        + ` ${this.variant.appName} desktop app (expected ${candidates.join(' or ')})`,
      )
    }
    if (!this.needsRefresh(credential)) return credential
    this.inflight ??= this.refreshNow(credential).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /** Read-only sign-in summary; never refreshes and never throws. */
  async status(): Promise<WorkBuddyAuthStatus> {
    try {
      const credential = await this.current()
      if (credential === undefined) return { state: 'signed-out', reason: 'no credential' }
      return {
        state: 'signed-in',
        ...credential.expiresAtMs > 0 ? { expiresAtMs: credential.expiresAtMs } : {},
        ...credential.nickname === undefined ? {} : { nickname: credential.nickname },
        ...credential.domain === '' ? {} : { domain: credential.domain },
        source: credential.source,
      }
    } catch (error: unknown) {
      return { state: 'signed-out', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private needsRefresh(credential: WorkBuddyCredential): boolean {
    if (credential.expiresAtMs <= 0) return true
    return Date.now() + this.refreshMarginMs >= credential.expiresAtMs
  }

  private async refreshNow(credential: WorkBuddyCredential): Promise<WorkBuddyCredential> {
    if (credential.refreshToken === '') {
      if (credential.expiresAtMs > Date.now() + 30_000) return credential
      throw new WorkBuddyCredentialError(
        `the ${this.variant.appName} access token expired and no refresh token is stored;`
        + ` sign in again in the ${this.variant.appName} desktop app`,
      )
    }
    let outcome: WorkBuddyRefreshOutcome
    try {
      outcome = await this.refresh(credential)
    } catch (error: unknown) {
      if (credential.expiresAtMs > Date.now() + 30_000) return credential
      throw new WorkBuddyCredentialError(
        `${this.variant.appName} token refresh failed and the access token is expired (${String(error)});`
        + ` open ${this.variant.appName} once to sign in again`,
      )
    }
    const refreshed: WorkBuddyCredential = {
      ...credential,
      accessToken: outcome.accessToken,
      ...outcome.refreshToken === undefined ? {} : { refreshToken: outcome.refreshToken },
      expiresAtMs: outcome.expiresInSec !== undefined
        ? Date.now() + outcome.expiresInSec * 1000
        : credential.expiresAtMs,
      ...outcome.domain === undefined || outcome.domain === '' ? {} : { domain: outcome.domain },
      source: 'own',
    }
    // Losing the copy is not a reason to fail the message: the refreshed token
    // is already in hand, and the app's file still holds the sign-in.
    try {
      await writeAtomic(this.ownPath, ownDocument(refreshed))
    } catch {
      // Ignored on purpose; see above.
    }
    return refreshed
  }

  /**
   * Read the first app file that exists. Only an absent file falls through to
   * the next candidate; a file that is present but unreadable is authoritative
   * for its slot, so a broken newer document never silently loses to an older
   * one. An encrypted document must be opened, never skipped.
   */
  private async readDesktop(): Promise<WorkBuddyCredential | undefined> {
    for (const path of this.desktopCandidates()) {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error: unknown) {
        if (!isENOENT(error)) throw error
        continue
      }
      const classification = classifyDesktopAuthDocument(text)
      if (classification.format === 'plaintext') return parseWorkBuddyAuth(text)
      if (classification.format === 'absent') continue
      if (classification.format === 'unrecognized') {
        throw new WorkBuddyCredentialError(
          `the ${this.variant.appName} auth file at ${path} exists but is unreadable`
          + ' (neither a plaintext credential nor a decodable WorkBuddy 5.6 envelope);'
          + ' fix or remove the file',
        )
      }
      const plaintext = await unwrapDesktopAuthDocument(this.variant, classification)
      return parseWorkBuddyAuth(plaintext)
    }
    return undefined
  }

  private async readOwn(): Promise<WorkBuddyCredential | undefined> {
    try {
      return parseOwnDocument(await readFile(this.ownPath, 'utf8'))
    } catch {
      // Absent or unreadable: the app's file still supplies the credential.
      return undefined
    }
  }
}

/**
 * The agent dir the extension writes its own state into.
 *
 * Pi resolves it from `PI_CODING_AGENT_DIR`, falling back to `~/.pi/agent`;
 * reading the exported `getAgentDir()` from the host package would be the
 * obvious choice, but it is only reachable through the host's index, which is
 * a large surface to load at extension start for one path.
 */
export function resolveAgentDir(): string {
  const fromEnv = process.env['PI_CODING_AGENT_DIR']?.trim()
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv.startsWith('~') ? join(homedir(), fromEnv.slice(1)) : fromEnv
  }
  return join(homedir(), '.pi', 'agent')
}
