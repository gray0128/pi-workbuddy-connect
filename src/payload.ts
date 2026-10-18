/**
 * Request-body normalization for the WorkBuddy gateway.
 *
 * pi-ai builds OpenAI-compatible bodies; the gateway accepts most of them but
 * rejects three specific shapes, each measured against the live endpoints:
 *
 * - a `developer` role (HTTP 400, code 11128) — pi only emits it for models
 *   whose compat allows it, and the models registered here say it does not, so
 *   this is a second gate rather than the primary fix;
 * - `reasoning_effort: "off"` (HTTP 400, code 11133) — omission is the only
 *   spelling measured good on every model, including models that declare
 *   `canDisableThinking`, whose real behavior is then decided upstream;
 * - a first message that is not `system` on the international gateway (HTTP
 *   400, code 11128).
 *
 * @module pi-workbuddy-connect/payload
 */

/** Minimal shape of the JSON body pi-ai hands to `onPayload`. */
export type ChatBody = Record<string, unknown>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rewrite `role: "developer"` messages to `role: "system"`. */
function normalizeDeveloperRole(body: ChatBody): void {
  const messages = body['messages']
  if (!Array.isArray(messages)) return
  for (const message of messages) {
    if (isObject(message) && message['role'] === 'developer') message['role'] = 'system'
  }
}

/**
 * Prepend a minimal system prompt when the body has none first.
 *
 * The added prompt carries no user content and is prepended, never merged, so
 * existing messages keep their order and wording.
 */
function ensureLeadingSystemMessage(body: ChatBody): void {
  const messages = body['messages']
  if (!Array.isArray(messages)) return
  const first = messages[0]
  if (isObject(first) && first['role'] === 'system') return
  messages.unshift({ role: 'system', content: 'You are a helpful assistant.' })
}

/**
 * Normalize one chat body in place and return it.
 *
 * Kept pure enough to test directly: it mutates only the object it is given.
 */
export function normalizeChatBody(body: ChatBody, international: boolean): ChatBody {
  // The upstream rejects non-streaming requests outright.
  body['stream'] = true
  normalizeDeveloperRole(body)
  // pi-ai sends this for any request carrying no explicit level, so covering
  // both the explicit "Off" selection and the default costs nothing.
  if (body['reasoning_effort'] === 'off') delete body['reasoning_effort']
  if (international) ensureLeadingSystemMessage(body)
  return body
}
