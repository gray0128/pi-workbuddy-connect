/**
 * The desktop apps' at-rest credential protection.
 *
 * Since WorkBuddy 5.6 both apps encrypt `auth.accessToken` and
 * `auth.refreshToken` at rest, so the auth file holds
 * `{$wbEncrypted: 1, envelope}` wrappers instead of token strings. Everything
 * needed to open them lives on the same machine:
 *
 * - the sealed payload (`{version: 1, atRestSecretKey}`) comes from the app's
 *   modified Electron through its private `workbuddyStorage` binding, reached
 *   by running *that app's own* binary once with `ELECTRON_RUN_AS_NODE=1`;
 * - `protectorKey = sha256(atRestSecretKey, utf8)` opens the envelopes with
 *   AES-256-GCM and the AAD below.
 *
 * A Pi extension cannot call `_linkedBinding` itself (it runs in Pi's Node, not
 * the forked Electron), so the helper is spawned. The key is cached in memory
 * only. Neither the payload, the key, nor any token is ever logged.
 *
 * @module pi-workbuddy-connect/desktop-credential
 */

import { execFile } from 'node:child_process'
import { createDecipheriv, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkBuddyVariant } from './variants.ts'

/** One decrypted-openable envelope's decoded parts. */
export interface WorkBuddyEnvelope {
  suite: number
  keyId: string
  nonce: Buffer
  authTag: Buffer
  ciphertext: Buffer
}

/** A token field found in its encrypted wrapper, with its envelope decoded. */
export interface WrappedTokenField {
  field: 'accessToken' | 'refreshToken'
  envelope: WorkBuddyEnvelope
}

/** How an auth document reads on disk. */
export type DesktopAuthFormat = 'absent' | 'plaintext' | 'encrypted' | 'unrecognized'

/** A classified auth document. */
export type DesktopAuthClassification =
  | { format: 'absent' }
  | { format: 'plaintext' }
  | { format: 'encrypted'; document: Record<string, unknown>; fields: readonly WrappedTokenField[] }
  | { format: 'unrecognized' }

/** Decode a base64 value and check its exact byte length when given. */
function decodeBase64(value: unknown, length?: number): Buffer | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const decoded = Buffer.from(value, 'base64')
  if (length !== undefined && decoded.length !== length) return undefined
  return decoded
}

/**
 * Whether a raw value is the 5.6 field wrapper, with its inner envelope
 * decodable. Anything claiming the flag whose envelope cannot be decoded makes
 * the document unrecognized: no key could ever open it, so it must not be
 * reported as merely "plaintext without a token".
 */
function parseWrappedField(field: 'accessToken' | 'refreshToken', value: unknown): WrappedTokenField | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const wrapped = value as Record<string, unknown>
  if (wrapped['$wbEncrypted'] !== 1 || typeof wrapped['envelope'] !== 'string') return undefined
  let inner: unknown
  try {
    inner = JSON.parse(Buffer.from(wrapped['envelope'], 'base64').toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return undefined
  const parts = inner as Record<string, unknown>
  const nonce = decodeBase64(parts['nonce'], 12)
  const authTag = decodeBase64(parts['authTag'], 16)
  const ciphertext = decodeBase64(parts['ciphertext'])
  if (nonce === undefined || authTag === undefined || ciphertext === undefined) return undefined
  // Suite 1 is the only scheme WorkBuddy 5.6.x defines for credential fields.
  // A future suite is not guessed at: the document reads as unrecognized.
  if (parts['suite'] !== 1) return undefined
  if (typeof parts['keyId'] !== 'string' || !/^[0-9a-f]{16}$/u.test(parts['keyId'])) return undefined
  return {
    field,
    envelope: { suite: 1, keyId: parts['keyId'], nonce, authTag, ciphertext },
  }
}

/** The `auth` member of a document, or the document itself in the flat form. */
function authSection(document: Record<string, unknown>): Record<string, unknown> {
  const auth = document['auth']
  return typeof auth === 'object' && auth !== null && !Array.isArray(auth)
    ? auth as Record<string, unknown>
    : document
}

/** Classify an auth document's on-disk form. */
export function classifyDesktopAuthDocument(text: string): DesktopAuthClassification {
  if (text.trim() === '') return { format: 'absent' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { format: 'unrecognized' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { format: 'unrecognized' }
  }
  const document = parsed as Record<string, unknown>
  const auth = authSection(document)
  const fields: WrappedTokenField[] = []
  for (const field of ['accessToken', 'refreshToken'] as const) {
    const raw = auth[field]
    // A plaintext string is the pre-5.6 shape; leave it to the normal parser.
    if (raw === undefined || typeof raw === 'string') continue
    const wrapped = parseWrappedField(field, raw)
    if (wrapped === undefined) return { format: 'unrecognized' }
    fields.push(wrapped)
  }
  if (fields.length === 0) return { format: 'plaintext' }
  return { format: 'encrypted', document, fields }
}

/**
 * The authenticated-context AAD for one field envelope, transcribed from the
 * app bundle's `buildAuthenticatedContextAad` and verified live against 5.6.x.
 * Credential fields are always suite 1 under the `field` framing (WBEV1); the
 * framing family's other members belong to other document kinds and are
 * deliberately not implemented.
 */
export function buildAuthenticatedContextAad(keyId: string, suite: number): Buffer {
  const prefix = Buffer.from('WB-AAD\0', 'ascii')
  const lengthPrefixed = (value: string): Buffer => {
    const bytes = Buffer.from(value, 'utf8')
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(bytes.length)
    return Buffer.concat([header, bytes])
  }
  const suiteBytes = Buffer.allocUnsafe(4)
  suiteBytes.writeUInt32BE(suite)
  // No sequence numbers on credential fields; the final byte 0 mirrors the
  // reference implementation's default context.
  return Buffer.concat([
    prefix, Buffer.from([1]),
    lengthPrefixed('WBEV1'),
    lengthPrefixed('sym-v1'),
    suiteBytes,
    lengthPrefixed(keyId),
    Buffer.from([2]),
    Buffer.from([0]),
    Buffer.from([0]),
  ])
}

/** Open one envelope with a protector key; `undefined` when it will not open. */
export function openAuthField(key: Buffer, envelope: WorkBuddyEnvelope): string | undefined {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.nonce, { authTagLength: 16 })
    decipher.setAAD(buildAuthenticatedContextAad(envelope.keyId, envelope.suite))
    decipher.setAuthTag(envelope.authTag)
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

/**
 * Validate the helper's payload against the app's own rules: `version: 1` and
 * a canonical-base64 32-byte, non-all-zero secret.
 */
export function parseAtRestPayload(text: string): { atRestSecretKey: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const payload = parsed as Record<string, unknown>
  if (payload['version'] !== 1) return undefined
  const secret = payload['atRestSecretKey']
  if (typeof secret !== 'string' || secret === '') return undefined
  const decoded = Buffer.from(secret, 'base64')
  if (decoded.length !== 32) return undefined
  if (decoded.toString('base64') !== secret) return undefined
  if (decoded.every(byte => byte === 0)) return undefined
  return { atRestSecretKey: secret }
}

/** Derive the protector key from the payload's secret (sha256 over its UTF-8 string). */
export function deriveProtectorKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

/**
 * The helper: run inside the app's Electron as plain Node, where the private
 * `workbuddyStorage` binding exists, and print only the payload. It writes
 * nothing else, so whatever reaches stdout is the payload.
 */
const HELPER_SCRIPT = 'process.stdout.write(String(process._linkedBinding("electron_browser_workbuddy_storage").loggerGet()))'

/** How long one helper spawn may take before it is called a failure. */
const HELPER_TIMEOUT_MS = 30_000

/** An error a status renderer can report verbatim. */
export class WorkBuddyCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkBuddyCredentialError'
  }
}

/** The Electron binary this variant would spawn, and where it came from. */
export interface ElectronBinary {
  path: string
  /** `env` for the explicit override, `installed` for the app's own binary. */
  source: 'env' | 'installed'
}

/**
 * Resolve the Electron binary for one variant: the explicit env var, then the
 * installed app's own executable. Missing return `undefined` and the caller
 * reports how to fix it; there is no fallback to a different app's binary,
 * because executing the wrong product is worse than reporting a missing one.
 */
export async function resolveElectronBinary(variant: WorkBuddyVariant): Promise<ElectronBinary | undefined> {
  const fromEnv = process.env[variant.electronEnv]?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return { path: fromEnv, source: 'env' }
  if (process.platform === 'darwin') {
    try {
      await readFile(join(variant.macOS.bundle, 'Contents', 'Info.plist'))
      return { path: variant.macOS.electronPath, source: 'installed' }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Per-variant in-memory cache, so a message does not re-spawn the helper. */
const keyCache = new Map<string, { key: Buffer; keyId: string }>()

/** Run the helper and return its validated payload. */
function runHelper(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      path,
      ['-e', HELPER_SCRIPT],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: HELPER_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(new WorkBuddyCredentialError(
            `could not read the app's at-rest key by running ${path}: ${error.message}`,
          ))
          return
        }
        resolve(stdout)
      },
    )
  })
}

/**
 * The protector key for one variant, cached per key id.
 *
 * The key is re-resolved when an envelope names a different key id: the app
 * re-seals its sign-in after a reinstall or a credential reset, and a stale
 * cached key would then fail to open a perfectly good document.
 */
export async function protectorKeyFor(
  variant: WorkBuddyVariant,
  keyIds: readonly string[],
): Promise<Buffer> {
  const cached = keyCache.get(variant.id)
  if (cached !== undefined && keyIds.every(id => id === cached.keyId)) return cached.key
  const binary = await resolveElectronBinary(variant)
  if (binary === undefined) {
    throw new WorkBuddyCredentialError(
      `the ${variant.appName} sign-in is encrypted and its app was not found;`
      + ` install ${variant.appName} or set ${variant.electronEnv} to its Electron binary`,
    )
  }
  const payload = parseAtRestPayload(await runHelper(binary.path))
  if (payload === undefined) {
    throw new WorkBuddyCredentialError(
      `${binary.path} returned no usable at-rest payload (expected {version:1, atRestSecretKey});`
      + ' open the app once so it can finish sealing its sign-in',
    )
  }
  const key = deriveProtectorKey(payload.atRestSecretKey)
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 16)
  keyCache.set(variant.id, { key, keyId })
  return key
}

/** Drop the cached key; `/reload` and tests rely on this. */
export function clearProtectorKeyCache(): void {
  keyCache.clear()
}

/**
 * Rebuild the document with plaintext token fields, so the regular auth parser
 * needs no second code path for encrypted files.
 */
export async function unwrapDesktopAuthDocument(
  variant: WorkBuddyVariant,
  classification: Extract<DesktopAuthClassification, { format: 'encrypted' }>,
): Promise<string> {
  const key = await protectorKeyFor(variant, classification.fields.map(field => field.envelope.keyId))
  const rebuilt = structuredClone(classification.document) as Record<string, unknown>
  const auth = authSection(rebuilt)
  for (const field of classification.fields) {
    const plaintext = openAuthField(key, field.envelope)
    if (plaintext === undefined) {
      throw new WorkBuddyCredentialError(
        `the encrypted ${variant.appName} sign-in's ${field.field} could not be decrypted`
        + ` (envelope key id ${field.envelope.keyId});`
        + ` open ${variant.appName} once to reseal the sign-in`,
      )
    }
    auth[field.field] = plaintext
  }
  return JSON.stringify(rebuilt)
}
