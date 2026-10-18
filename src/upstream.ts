/**
 * The WorkBuddy upstream client: model catalog, token refresh, and credit
 * balance. Chat itself is served by pi-ai's OpenAI-completions implementation
 * through a small payload normalizer (see `payload.ts`), so this module owns
 * only the requests that are not plain chat completions.
 *
 * @module pi-workbuddy-connect/upstream
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { WorkBuddyCredential, WorkBuddyRefreshOutcome } from './auth.ts'
import { parseModelCatalog, type WorkBuddyModelInfo } from './catalog.ts'
import { regionOf, type WorkBuddyRegion, type WorkBuddyVariant } from './variants.ts'

const CN_CHAT_BASE = 'https://copilot.tencent.com'
const CN_BILLING_BASE = 'https://www.codebuddy.cn'
const GLOBAL_BASE = 'https://www.workbuddy.ai'

/** The CLI-shaped User-Agent that selects the `cli` roster on `/v3/config`. */
const CLI_USER_AGENT = 'CLI/2.63.2 CodeBuddy/2.63.2'

/**
 * Version baked into the desktop User-Agent as `WorkBuddy/<v>`.
 *
 * The gateway ignores the number when it splits the UA — 5.5.2 and 5.8.4 both
 * returned the same roster — so this is a shape requirement, not a claim about
 * the installed app. When the app's own version can be read it is used instead.
 */
const FALLBACK_CN_APP_VERSION = '5.8.3'
const FALLBACK_AI_APP_VERSION = '5.8.4'

const JSON_TIMEOUT_MS = 30_000

/** One billing package and its remaining credit. */
export interface WorkBuddyCreditAccount {
  packageName: string
  remain: number
  size: number
  /** When the package's own cycle ends, epoch ms. */
  endTimeMs?: number
}

/** Aggregated credit answer for one credential. */
export interface WorkBuddyCredits {
  total: number
  accounts: readonly WorkBuddyCreditAccount[]
}

/** Where a catalog answer came from, for the status command. */
export type WorkBuddyCatalogSource = 'live' | 'fallback'

/** A catalog answer plus its provenance. */
export interface WorkBuddyCatalogResult {
  models: readonly WorkBuddyModelInfo[]
  source: WorkBuddyCatalogSource
  /** Why the live fetch failed, when it did. */
  error?: string
  fetchedAtMs: number
}

/** The resolved desktop identity chat and catalog requests present as. */
export interface WorkBuddyIdentity {
  appVersion: string
  /** Bundled agent-CLI version; absent drops the `CLI/…` UA token. */
  cliVersion?: string
}

function chatBase(credential: WorkBuddyCredential): string {
  return regionOf(credential.domain) === 'global' ? GLOBAL_BASE : CN_CHAT_BASE
}

function billingBase(credential: WorkBuddyCredential): string {
  return regionOf(credential.domain) === 'global' ? GLOBAL_BASE : CN_BILLING_BASE
}

/** The origin every request presents as its own. */
function originReferer(credential: WorkBuddyCredential): string {
  return regionOf(credential.domain) === 'global' ? GLOBAL_BASE : CN_BILLING_BASE
}

/** Headers every upstream request shares. */
function commonHeaders(credential: WorkBuddyCredential): Record<string, string> {
  return {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': originReferer(credential),
    'Referer': `${originReferer(credential)}/`,
    'User-Agent': CLI_USER_AGENT,
  }
}

/** One JSON-envelope response, already unwrapped. */
interface Envelope {
  code: number
  msg: string
  data: unknown
  document: Record<string, unknown>
}

async function readEnvelope(response: Response): Promise<Envelope> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`workbuddy upstream returned non-JSON (http ${response.status}): ${text.slice(0, 160)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`workbuddy upstream returned an unexpected document (http ${response.status})`)
  }
  const document = parsed as Record<string, unknown>
  return {
    code: typeof document['code'] === 'number' ? document['code'] : 0,
    msg: typeof document['msg'] === 'string' ? document['msg'] : '',
    data: 'data' in document ? document['data'] : undefined,
    document,
  }
}

/** Fail an envelope whose business code is non-zero. */
function envelopeError(status: number, envelope: Envelope): Error {
  const message = envelope.msg !== '' ? envelope.msg : 'unexpected response'
  return new Error(`workbuddy upstream rejected the request (http ${status}): ${message.slice(0, 200)}`)
}

/** Whether a value is a version safe to interpolate into an HTTP header. */
export function validAppVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,6}(?:\.\d{1,6}){1,3}$/u.test(value)
}

/** macOS App-bundle roots, system-wide first. */
const MAC_APP_ROOTS = ['/Applications', join(homedir(), 'Applications')]

/**
 * Read `CFBundleShortVersionString` out of an `Info.plist`.
 *
 * Parsed as XML rather than grepped: the plist holds many `<string>` values,
 * and a loose match would eventually return a different key's value.
 */
export async function readBundleVersion(plistPath: string): Promise<string | undefined> {
  let text: string
  try {
    text = await readFile(plistPath, 'utf8')
  } catch {
    return undefined
  }
  const match = /<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>([^<]*)<\/string>/u.exec(text)
  const version = match?.[1]?.trim()
  return validAppVersion(version) ? version : undefined
}

/**
 * The bundled agent CLI's version, or `undefined` when it does not resolve.
 *
 * `cli/package.json` ships `0.0.0` in `version` with the real version in
 * `publishConfig.customPackage.version`, so a valid non-placeholder `version`
 * wins and unreadable metadata yields `undefined` (the UA then drops the
 * `CLI/…` token instead of inventing one).
 */
export async function readCliVersion(bundle: string): Promise<string | undefined> {
  let document: unknown
  try {
    document = JSON.parse(await readFile(
      join(bundle, 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'package.json'),
      'utf8',
    ))
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return undefined
  const pkg = document as Record<string, unknown>
  const declared = pkg['version']
  if (validAppVersion(declared) && declared !== '0.0.0') return declared
  const publishConfig = pkg['publishConfig']
  const custom = typeof publishConfig === 'object' && publishConfig !== null
    ? (publishConfig as Record<string, unknown>)['customPackage']
    : undefined
  const customVersion = typeof custom === 'object' && custom !== null
    ? (custom as Record<string, unknown>)['version']
    : undefined
  return validAppVersion(customVersion) ? customVersion : undefined
}

/** The installed app's version, when it can be read. */
export async function installedAppVersion(variant: WorkBuddyVariant): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  const bundle = basename(variant.macOS.bundle)
  for (const root of MAC_APP_ROOTS) {
    const version = await readBundleVersion(join(root, bundle, 'Contents', 'Info.plist'))
    if (version !== undefined) return version
  }
  return undefined
}

/**
 * Resolve the desktop identity: installed app version, then a compiled-in
 * fallback. Resolution never blocks a message — an unreadable bundle simply
 * yields the fallback shape.
 */
export async function resolveIdentity(variant: WorkBuddyVariant): Promise<WorkBuddyIdentity> {
  const appVersion = await installedAppVersion(variant)
  const fallback = variant.region === 'global' ? FALLBACK_AI_APP_VERSION : FALLBACK_CN_APP_VERSION
  const cliVersion = process.platform === 'darwin' ? await readCliVersion(variant.macOS.bundle) : undefined
  return {
    appVersion: appVersion ?? fallback,
    ...cliVersion === undefined ? {} : { cliVersion },
  }
}

/**
 * The chat User-Agent: the shape the desktop client composes,
 * `WorkBuddy/<v> <product>/<v>` with an optional trailing `CLI/<cli>`.
 *
 * Throws on an invalid version rather than interpolating one into a header;
 * `resolveIdentity` never produces such an identity, so the throw is a last
 * gate against future call-site mistakes.
 */
export function chatUserAgent(identity: WorkBuddyIdentity, region: WorkBuddyRegion): string {
  if (!validAppVersion(identity.appVersion)) {
    throw new Error(`invalid app version for chat User-Agent: ${JSON.stringify(identity.appVersion)}`)
  }
  const product = region === 'global' ? 'WorkBuddy AI' : 'WorkBuddy'
  const parts = [`WorkBuddy/${identity.appVersion}`, `${product}/${identity.appVersion}`]
  if (identity.cliVersion !== undefined) {
    if (!validAppVersion(identity.cliVersion)) {
      throw new Error(`invalid CLI version for chat User-Agent: ${JSON.stringify(identity.cliVersion)}`)
    }
    parts.push(`CLI/${identity.cliVersion}`)
  }
  return parts.join(' ')
}

/**
 * The conversation-channel trio the chat endpoints require.
 *
 * The international gateway answers a chat that omits all three with `400` /
 * code `11128`. A fresh UUID per request is enough: the upstream keeps no
 * history keyed by the id, and fresh ids keep concurrent requests off one
 * shared conversation.
 */
export function conversationHeaders(): Record<string, string> {
  return {
    'X-Conversation-ID': randomUUID(),
    'X-Conversation-Request-ID': randomUUID(),
    'X-Conversation-Message-ID': randomUUID(),
  }
}

/**
 * Headers for a chat request. The credential itself is passed as pi-ai's
 * apiKey and arrives as `Authorization: Bearer …`; nothing here carries the
 * refresh token.
 */
export function chatHeaders(
  credential: WorkBuddyCredential,
  identity: WorkBuddyIdentity,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...commonHeaders(credential),
    'User-Agent': chatUserAgent(identity, regionOf(credential.domain)),
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Version': identity.appVersion,
    'X-Product': 'SaaS',
    ...conversationHeaders(),
  }
  if (credential.uid !== '') headers['X-User-Id'] = credential.uid
  if (credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
    headers['X-Enterprise-Id'] = credential.enterpriseId
  }
  if (credential.domain !== '') headers['X-Domain'] = credential.domain
  return headers
}

/** Constructor dependencies; the identity resolver is injectable for tests. */
export interface WorkBuddyUpstreamOptions {
  variant: WorkBuddyVariant
  resolveIdentity?: () => Promise<WorkBuddyIdentity>
}

/**
 * The WorkBuddy upstream operations that are not plain chat completions.
 *
 * One instance per variant: the catalog, identity, and endpoints all follow
 * the variant, and neither variant's failure can stop the other.
 */
export class WorkBuddyUpstream {
  private readonly variant: WorkBuddyVariant
  private readonly resolveIdentity: () => Promise<WorkBuddyIdentity>

  constructor(options: WorkBuddyUpstreamOptions) {
    this.variant = options.variant
    this.resolveIdentity = options.resolveIdentity ?? (() => resolveIdentity(this.variant))
  }

  /**
   * POST the token-refresh endpoint.
   *
   * The refresh token travels in `X-Refresh-Token`, never in the body, and
   * never on a chat request: the upstream rotates it on every call, and the
   * caller persists the rotated value in the plugin-owned copy.
   */
  async refreshToken(credential: WorkBuddyCredential): Promise<WorkBuddyRefreshOutcome> {
    const response = await fetch(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
      method: 'POST',
      headers: {
        ...commonHeaders(credential),
        'X-Refresh-Token': credential.refreshToken,
        'X-Auth-Refresh-Source': 'workbuddy',
        ...credential.enterpriseId === undefined || credential.enterpriseId === ''
          ? {}
          : { 'X-Enterprise-Id': credential.enterpriseId },
      },
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    })
    const envelope = await readEnvelope(response)
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope)
    const data = typeof envelope.data === 'object' && envelope.data !== null
      ? envelope.data as Record<string, unknown>
      : {}
    const accessToken = typeof data['accessToken'] === 'string' ? data['accessToken'] : ''
    if (accessToken === '') {
      throw new Error(`workbuddy token refresh returned no accessToken; sign in again in ${this.variant.appName}`)
    }
    return {
      accessToken,
      ...typeof data['refreshToken'] === 'string' && data['refreshToken'] !== ''
        ? { refreshToken: data['refreshToken'] }
        : {},
      ...typeof data['expiresIn'] === 'number' && data['expiresIn'] > 0
        ? { expiresInSec: data['expiresIn'] }
        : {},
      ...typeof data['domain'] === 'string' && data['domain'] !== '' ? { domain: data['domain'] } : {},
    }
  }

  /**
   * GET the model catalog.
   *
   * Both variants read `/v3/config`, the product document the desktop app
   * itself fetches. What differs is the User-Agent, and the split is
   * load-bearing: a CLI-shaped UA yields the `cli` roster this extension can
   * chat with, while an App-shaped UA yields the app's internal roster (whose
   * ids the chat endpoint rejects for this client identity). The international
   * variant therefore presents `WorkBuddyAI/<v>` and reads the same `cli`
   * agent out of that document.
   */
  async fetchModels(credential: WorkBuddyCredential, signal?: AbortSignal): Promise<readonly WorkBuddyModelInfo[]> {
    const international = regionOf(credential.domain) === 'global'
    const identity = await this.resolveIdentity()
    const userAgent = international ? `WorkBuddyAI/${identity.appVersion}` : CLI_USER_AGENT
    const response = await fetch(`${chatBase(credential)}/v3/config`, {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        Accept: 'application/json',
        Origin: originReferer(credential),
        Referer: `${originReferer(credential)}/`,
        ...international
          ? { 'X-Requested-With': 'XMLHttpRequest', 'X-Product': 'SaaS' }
          : this.identityHeaders(credential),
        'User-Agent': userAgent,
      },
      signal: signal === undefined
        ? AbortSignal.timeout(JSON_TIMEOUT_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(JSON_TIMEOUT_MS)]),
    })
    const envelope = await readEnvelope(response)
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope)
    // The endpoints normally wrap the document in `{code,msg,data}`, but
    // `/v3/config` has also been observed answering with the product document
    // bare. A body that itself looks like a catalog is used as the answer.
    const data = typeof envelope.data === 'object' && envelope.data !== null
      ? envelope.data as Record<string, unknown>
      : 'models' in envelope.document || 'agents' in envelope.document
        ? envelope.document
        : {}
    return parseModelCatalog(data, international)
  }

  /**
   * Fetch the catalog, falling back to the static table.
   *
   * The fallback is a captured snapshot, so the card says where the list came
   * from rather than pretending a stale table is the live roster.
   */
  async catalog(credential: WorkBuddyCredential | undefined, fallback: readonly WorkBuddyModelInfo[], signal?: AbortSignal): Promise<WorkBuddyCatalogResult> {
    if (credential === undefined) {
      return { models: fallback, source: 'fallback', error: 'no credential', fetchedAtMs: Date.now() }
    }
    try {
      const models = await this.fetchModels(credential, signal)
      return { models, source: 'live', fetchedAtMs: Date.now() }
    } catch (error: unknown) {
      return {
        models: fallback,
        source: 'fallback',
        error: error instanceof Error ? error.message : String(error),
        fetchedAtMs: Date.now(),
      }
    }
  }

  /**
   * POST the billing endpoint for the aggregated remaining credit.
   *
   * Every read is a real, billable query on the upstream side, so callers must
   * treat this as an on-demand action rather than a poll.
   */
  async fetchCredits(credential: WorkBuddyCredential): Promise<WorkBuddyCredits> {
    const now = new Date()
    const format = (date: Date): string => [
      date.getFullYear().toString().padStart(4, '0'),
      (date.getMonth() + 1).toString().padStart(2, '0'),
      date.getDate().toString().padStart(2, '0'),
    ].join('-') + ' ' + [
      date.getHours().toString().padStart(2, '0'),
      date.getMinutes().toString().padStart(2, '0'),
      date.getSeconds().toString().padStart(2, '0'),
    ].join(':')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }
    if (credential.uid !== '') headers['X-User-Id'] = credential.uid
    if (credential.enterpriseId !== undefined && credential.enterpriseId !== '') {
      headers['X-Enterprise-Id'] = credential.enterpriseId
      headers['X-Tenant-Id'] = credential.enterpriseId
    }
    if (credential.domain !== '') headers['X-Domain'] = credential.domain
    const response = await fetch(`${billingBase(credential)}/v2/billing/meter/get-user-resource`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        PageNumber: 1,
        PageSize: 100,
        ProductCode: 'p_tcaca',
        Status: [0, 3],
        PackageEndTimeRangeBegin: format(now),
        PackageEndTimeRangeEnd: format(new Date(now.getTime() + 365 * 101 * 24 * 3600 * 1000)),
      }),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    })
    const envelope = await readEnvelope(response)
    if (!response.ok || envelope.code !== 0) throw envelopeError(response.status, envelope)
    const wrapper = typeof envelope.data === 'object' && envelope.data !== null
      ? envelope.data as Record<string, unknown>
      : {}
    const body = typeof wrapper['Response'] === 'object' && wrapper['Response'] !== null
      ? wrapper['Response'] as Record<string, unknown>
      : {}
    const inner = typeof body['Data'] === 'object' && body['Data'] !== null
      ? body['Data'] as Record<string, unknown>
      : {}
    const rows = Array.isArray(inner['Accounts']) ? inner['Accounts'] : []
    const accounts: WorkBuddyCreditAccount[] = []
    let total = 0
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const account = row as Record<string, unknown>
      const numberAt = (key: string): number => typeof account[key] === 'number' ? account[key] as number : 0
      const size = numberAt('CycleCapacitySize') > 0 ? numberAt('CycleCapacitySize') : numberAt('CapacitySize')
      const cycleRemain = numberAt('CycleCapacityRemain')
      const cycleUsed = numberAt('CycleCapacityUsed')
      // A cycle-based package reports its remaining cycle quota; a plain
      // capacity package reports the flat remain. Preferring the cycle value
      // only when the package declares a cycle avoids summing a stale field.
      let remain = size > 0 && numberAt('CycleCapacitySize') > 0
        ? cycleRemain
        : cycleRemain > 0 || cycleUsed > 0
          ? cycleRemain
          : numberAt('CapacityRemain')
      if (remain < 0) remain = 0
      total += remain
      const endTimeMs = parseCycleEndTime(account['CycleEndTime'])
      accounts.push({
        packageName: typeof account['PackageName'] === 'string' ? account['PackageName'] : '(unnamed)',
        remain,
        size,
        ...endTimeMs === undefined ? {} : { endTimeMs },
      })
    }
    return { total, accounts }
  }

  /**
   * Account-identity headers for the CN catalog.
   *
   * The gateway also splits `/v3/config` by account identity, and the pair is
   * all-or-nothing: an enterprise account without it is silently answered with
   * the personal roster, while `X-Enterprise-Id` alone is rejected outright.
   */
  private identityHeaders(credential: WorkBuddyCredential): Record<string, string> {
    if (credential.uid === '') return {}
    if (credential.enterpriseId === undefined || credential.enterpriseId === '') return {}
    const headers: Record<string, string> = {
      'X-User-Id': credential.uid,
      'X-Enterprise-Id': credential.enterpriseId,
      'X-Tenant-Id': credential.enterpriseId,
    }
    if (credential.domain !== '') headers['X-Domain'] = credential.domain
    return headers
  }
}

/**
 * Parse the billing response's `CycleEndTime` into epoch milliseconds.
 *
 * The upstream sends a zone-less `YYYY-MM-DD HH:mm:ss`, read here as the
 * running machine's local time — what the official desktop client does. That
 * makes the extension agree with the app on the same machine; it is not
 * evidence of which zone the server means.
 *
 * `Date` rolls overflowing fields forward (Feb 30 becomes Mar 2), so every
 * field is compared back: a stamp that is not a real moment reads as unknown
 * rather than as a confident nearby date.
 */
export function parseCycleEndTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/u.exec(value.trim())
  if (match === null) return undefined
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number, number, number, number, number, number,
  ]
  const date = new Date(year, month - 1, day, hour, minute, second)
  const parsed = date.getTime()
  if (!Number.isFinite(parsed)) return undefined
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) {
    return undefined
  }
  return parsed
}
