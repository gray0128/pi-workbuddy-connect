import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayName, normalizeCredits, reasoningFields, toPiModel } from '../src/models.ts'
import type { WorkBuddyModelInfo } from '../src/catalog.ts'

const base: WorkBuddyModelInfo = {
  id: 'glm-5.3',
  name: 'GLM-5.3',
  contextWindow: 1_000_000,
  maxTokens: 64_000,
  supportsImages: true,
  credits: 'x0.79 credits',
}

test('credits are reduced to a language-neutral multiplier', () => {
  assert.equal(normalizeCredits('x0.79 credits'), 'x0.79')
  assert.equal(normalizeCredits('x0.79'), 'x0.79')
  assert.equal(normalizeCredits('credits'), undefined)
  assert.equal(normalizeCredits('  '), undefined)
  assert.equal(normalizeCredits(undefined), undefined)
})

test('the multiplier rides the display name, and only when known', () => {
  assert.equal(displayName(base), 'GLM-5.3 · x0.79')
  assert.equal(displayName({ ...base, credits: undefined }), 'GLM-5.3')
})

test('a model without a declared effort set offers no thinking control', () => {
  assert.deepEqual(reasoningFields(base), { reasoning: false })
  assert.deepEqual(
    reasoningFields({ ...base, reasoning: { supports: true, canDisableThinking: true, onlyReasoning: false } }),
    { reasoning: false },
  )
})

test('declared efforts map to their wire spellings; undeclared levels are null', () => {
  const fields = reasoningFields({
    ...base,
    reasoning: { supports: true, supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', canDisableThinking: true, onlyReasoning: false },
  })
  assert.equal(fields.reasoning, true)
  assert.deepEqual(fields.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: 'low',
    medium: null,
    high: 'high',
    xhigh: null,
    max: 'max',
  })
})

test('off is never offered even when the row declares thinking can be disabled', () => {
  // `reasoning_effort: "off"` is rejected upstream; an Off entry would promise
  // a request the extension cannot make.
  const fields = reasoningFields({
    ...base,
    reasoning: { supports: true, supportedEfforts: ['low'], canDisableThinking: true, onlyReasoning: false },
  })
  assert.equal(fields.thinkingLevelMap?.['off'], null)
})

test('a model descriptor points at the gateway with the measured compat flags', () => {
  const model = toPiModel(base, { id: 'workbuddy' }, 'https://copilot.tencent.com/v2')
  assert.equal(model.id, 'glm-5.3')
  assert.equal(model.provider, 'workbuddy')
  assert.equal(model.baseUrl, 'https://copilot.tencent.com/v2')
  assert.equal(model.api, 'openai-completions')
  assert.deepEqual(model.input, ['text', 'image'])
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const compat = model.compat as Record<string, unknown>
  assert.equal(compat['supportsDeveloperRole'], false)
  assert.equal(compat['supportsStore'], false)
  assert.equal(compat['maxTokensField'], 'max_tokens')
})

test('text-only rows do not claim image input', () => {
  const model = toPiModel({ ...base, supportsImages: false }, { id: 'workbuddy' }, 'https://copilot.tencent.com/v2')
  assert.deepEqual(model.input, ['text'])
})
