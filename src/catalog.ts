/**
 * The WorkBuddy model catalog.
 *
 * The live list comes from the desktop product's `/v3/config` document, which
 * the gateway splits by User-Agent: a CLI-shaped UA yields the `cli` agent
 * roster this extension can chat with. The static tables below are captured
 * from live endpoints and serve two purposes only — they let the provider
 * register usable models before the first fetch and while offline, and they
 * keep the picker populated when a fetch fails.
 *
 * @module pi-workbuddy-connect/catalog
 */

/** One effort spelling WorkBuddy accepts on the wire. */
export type WorkBuddyEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Reasoning metadata the upstream catalog declares for one model. */
export interface WorkBuddyReasoning {
  supports: boolean
  /** Selectable effort values; absent means the model declares no set. */
  supportedEfforts?: readonly WorkBuddyEffort[]
  /** Effort the upstream uses when none is chosen. */
  defaultEffort?: WorkBuddyEffort
  /** Whether thinking can be switched off; false means it is always on. */
  canDisableThinking: boolean
  /** Whether the model only ever reasons. */
  onlyReasoning: boolean
}

/** One model the extension exposes. */
export interface WorkBuddyModelInfo {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  supportsImages: boolean
  /** Credits multiplier as the upstream spells it, e.g. `x0.79 credits`. */
  credits?: string
  reasoning?: WorkBuddyReasoning
}

/** The effort spellings the upstream uses; `minimal` is not one of them. */
export const EFFORT_VALUES: readonly WorkBuddyEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * CN models observed on the live `/v3/config` document on 2026-10-18, in the
 * `cli` roster's order. Captured, not promised: the roster churns, and the
 * live fetch replaces this table on every successful refresh.
 */
export const FALLBACK_CN_MODELS: readonly WorkBuddyModelInfo[] = [
  { id: 'deepseek-v4-pro', name: 'Deepseek-V4-Pro', contextWindow: 1000000, maxTokens: 128000, supportsImages: true },
  { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'minimax-m3', name: 'MiniMax-M3', contextWindow: 512000, maxTokens: 64000, supportsImages: true },
  { id: 'minimax-m2.7', name: 'MiniMax-M2.7', contextWindow: 200000, maxTokens: 48000, supportsImages: true },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'max', canDisableThinking: false, onlyReasoning: true } },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1000000, maxTokens: 131072, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1000000, maxTokens: 64000, supportsImages: true },
  { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200000, maxTokens: 48000, supportsImages: true },
  { id: 'glm-5v-turbo', name: 'GLM-5v-Turbo', contextWindow: 200000, maxTokens: 64000, supportsImages: true },
  { id: 'kimi-k3-1', name: 'Kimi-K3', contextWindow: 1000000, maxTokens: 32000, supportsImages: true },
  { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', contextWindow: 1000000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: true } },
  { id: 'kimi-k2.7', name: 'Kimi-K2.7-Code', contextWindow: 256000, maxTokens: 32000, supportsImages: true },
  { id: 'kimi-k2.6', name: 'Kimi-K2.6', contextWindow: 256000, maxTokens: 32000, supportsImages: true },
  { id: 'hy3', name: 'Hy3', contextWindow: 192000, maxTokens: 64000, supportsImages: true },
  { id: 'hy3-x', name: 'Hy3', contextWindow: 192000, maxTokens: 64000, supportsImages: true },
  { id: 'hy4-preview', name: 'Hy4 preview', contextWindow: 960000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['high'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'space-bunny', name: 'Space-Bunny', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'max', canDisableThinking: false, onlyReasoning: true } },
  { id: 'step-5-preview', name: 'Step-5-Preview', contextWindow: 1000000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
]

/** International models observed the same day, in its `cli` roster's order. */
export const FALLBACK_AI_MODELS: readonly WorkBuddyModelInfo[] = [
  { id: 'default-model', name: 'Auto', contextWindow: 176000, maxTokens: 24000, supportsImages: true },
  { id: 'fast-model', name: 'Fast', contextWindow: 200000, maxTokens: 32000, supportsImages: true },
  { id: 'balanced-model', name: 'Balanced', contextWindow: 256000, maxTokens: 32000, supportsImages: true },
  { id: 'primary-model', name: 'Primary', contextWindow: 272000, maxTokens: 72000, supportsImages: true },
  { id: 'deepseek-v4.1-flash', name: 'Deepseek-V4.1-Flash', contextWindow: 1000000, maxTokens: 128000, supportsImages: true },
  { id: 'deepseek-v4.1-flash-sg', name: 'Deepseek-V4.1-Flash', contextWindow: 1000000, maxTokens: 128000, supportsImages: true },
  { id: 'hy4-preview', name: 'Hy4 preview', contextWindow: 1000000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['high'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'hy3', name: 'Hy3', contextWindow: 192000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', contextWindow: 1000000, maxTokens: 32000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: true } },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: false } },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: false } },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: false } },
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 272000, maxTokens: 72000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gemini-3.5-flash', name: 'Gemini-3.5-Flash', contextWindow: 1000000, maxTokens: 65536, supportsImages: true },
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: true } },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', contextWindow: 1000000, maxTokens: 32000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: true } },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, maxTokens: 48000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: true } },
  { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1000000, maxTokens: 48000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['high', 'xhigh'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: false } },
  { id: 'kimi-k3', name: 'Kimi-K3', contextWindow: 1000000, maxTokens: 32000, supportsImages: true },
  { id: 'kimi-k2.6', name: 'Kimi-K2.6', contextWindow: 256000, maxTokens: 32000, supportsImages: true },
  { id: 'grok-4.7', name: 'Grok-4.7', contextWindow: 500000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gemini-3.8-flash', name: 'Gemini-3.8-Flash', contextWindow: 1000000, maxTokens: 65536, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', contextWindow: 1000000, maxTokens: 128000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false, onlyReasoning: true } },
  { id: 'step-5-preview', name: 'Step-5-Preview', contextWindow: 1000000, maxTokens: 64000, supportsImages: true, reasoning: { supports: true, supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium', canDisableThinking: false, onlyReasoning: true } },
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Parse the upstream `reasoning` object, defaulting to "no declared control". */
function parseReasoning(row: Record<string, unknown>): WorkBuddyReasoning | undefined {
  const supports = row['supportsReasoning'] === true
  const raw = row['reasoning']
  const declared = isObject(raw) ? raw : undefined
  const efforts: WorkBuddyEffort[] = []
  const rawEfforts = declared?.['supportedEfforts']
  if (Array.isArray(rawEfforts)) {
    for (const value of rawEfforts) {
      if (typeof value === 'string' && (EFFORT_VALUES as readonly string[]).includes(value)) {
        efforts.push(value as WorkBuddyEffort)
      }
    }
  }
  if (!supports && efforts.length === 0) return undefined
  const rawDefault = declared?.['defaultEffort'] ?? declared?.['effort']
  const defaultEffort = typeof rawDefault === 'string'
    && (EFFORT_VALUES as readonly string[]).includes(rawDefault)
    ? rawDefault as WorkBuddyEffort
    : undefined
  return {
    supports,
    ...efforts.length === 0 ? {} : { supportedEfforts: efforts },
    ...defaultEffort === undefined ? {} : { defaultEffort },
    // Only an explicit `true` offers "thinking off": older rows omit the field
    // and reject an `off` request.
    canDisableThinking: declared?.['canDisableThinking'] === true,
    onlyReasoning: row['onlyReasoning'] === true,
  }
}

/**
 * Make display names unique within one catalog.
 *
 * The CN document names both `hy3` and `hy3-x` "Hy3" while their rates differ,
 * so the picker would render two identical rows. The suffix comes from the id
 * (`hy3-x` reads "Hy3-X"); ids are untouched because they are the wire
 * contract.
 */
function disambiguateNames(models: readonly WorkBuddyModelInfo[]): WorkBuddyModelInfo[] {
  const seen = new Set<string>()
  return models.map(model => {
    const key = model.name.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      return model
    }
    const tail = model.id.toLowerCase().startsWith(key) ? model.id.slice(key.length) : ''
    if (tail === '') return model
    const name = `${model.name}${tail.toUpperCase()}`
    seen.add(name.toLowerCase())
    return { ...model, name }
  })
}

/**
 * Parse one `/v3/config` product document.
 *
 * Membership is the `cli` agent's roster intersected with the usable rows: the
 * roster is what a CLI-shaped identity may chat with, and joining rather than
 * trusting it outright drops ids the roster retired and rows the document
 * lists but cannot serve (disabled, or non-positive caps).
 *
 * @param data - the unwrapped catalog document.
 * @param international - whether it is the international product document,
 * whose rows carry a `contextWindow` object instead of a plain input cap.
 */
export function parseModelCatalog(
  data: Record<string, unknown>,
  international: boolean,
): readonly WorkBuddyModelInfo[] {
  const agents = Array.isArray(data['agents']) ? data['agents'] : []
  let roster: readonly string[] | undefined
  for (const agent of agents) {
    if (!isObject(agent)) continue
    if (agent['name'] === 'cli' && Array.isArray(agent['models'])) {
      roster = agent['models'].filter((id): id is string => typeof id === 'string')
      break
    }
  }
  if (roster === undefined || roster.length === 0) {
    throw new Error('workbuddy model catalog lists no cli agent models')
  }
  const rows = Array.isArray(data['models']) ? data['models'] : []
  const byId = new Map<string, WorkBuddyModelInfo>()
  for (const row of rows) {
    if (!isObject(row)) continue
    const id = typeof row['id'] === 'string' ? row['id'] : ''
    if (id === '' || row['disabled'] === true) continue
    const input = typeof row['maxInputTokens'] === 'number' ? row['maxInputTokens'] : 0
    const output = typeof row['maxOutputTokens'] === 'number' ? row['maxOutputTokens'] : 0
    if (input <= 0 || output <= 0) continue
    const window = isObject(row['contextWindow']) ? row['contextWindow'] : undefined
    const defaultLength = window?.['defaultLength']
    const credits = typeof row['credits'] === 'string' && row['credits'].trim() !== ''
      ? row['credits'].trim()
      : undefined
    const reasoning = parseReasoning(row)
    byId.set(id, {
      id,
      name: typeof row['name'] === 'string' && row['name'] !== '' ? row['name'] : id,
      contextWindow: international && positive(defaultLength) ? defaultLength : input,
      maxTokens: output,
      // Over-claiming admits an image the upstream then rejects after the
      // message is durable, so an unknown capability stays text-only.
      supportsImages: row['supportsImages'] === true && row['disabledMultimodal'] !== true,
      ...credits === undefined ? {} : { credits },
      ...reasoning === undefined ? {} : { reasoning },
    })
  }
  const models = roster
    .map(id => byId.get(id))
    .filter((model): model is WorkBuddyModelInfo => model !== undefined)
  if (models.length === 0) throw new Error('workbuddy model catalog resolved to an empty list')
  return disambiguateNames(models)
}
