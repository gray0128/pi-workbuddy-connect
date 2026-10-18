import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseModelCatalog } from '../src/catalog.ts'

const cliDocument = {
  agents: [{ name: 'cli', models: ['alpha', 'beta', 'gone'] }],
  models: [
    { id: 'alpha', name: 'Alpha', maxInputTokens: 200000, maxOutputTokens: 8192, supportsImages: false, credits: 'x0.25 credits' },
    { id: 'beta', name: 'Beta', maxInputTokens: 1000000, maxOutputTokens: 64000, supportsImages: true, supportsReasoning: true, onlyReasoning: true, credits: 'x0.79' },
    { id: 'disabled', name: 'Disabled', maxInputTokens: 1, maxOutputTokens: 1, disabled: true },
    { id: 'nocaps', name: 'No caps', maxInputTokens: 0, maxOutputTokens: 0 },
    { id: 'other', name: 'Not in roster', maxInputTokens: 1000, maxOutputTokens: 1000 },
  ],
}

test('roster intersect: only usable rows the cli agent lists survive', () => {
  const models = parseModelCatalog(cliDocument, false)
  assert.deepEqual(models.map(model => model.id), ['alpha', 'beta'])
})

test('credits and image capability come from the row', () => {
  const [alpha, beta] = parseModelCatalog(cliDocument, false)
  assert.equal(alpha?.credits, 'x0.25 credits')
  assert.equal(alpha?.supportsImages, false)
  assert.equal(beta?.supportsImages, true)
})

test('declared efforts are kept and default to no control when absent', () => {
  const document = {
    agents: [{ name: 'cli', models: ['a', 'b'] }],
    models: [
      {
        id: 'a',
        name: 'A',
        maxInputTokens: 1000,
        maxOutputTokens: 100,
        supportsReasoning: true,
        onlyReasoning: true,
        reasoning: { supportedEfforts: ['low', 'max'], defaultEffort: 'high', canDisableThinking: true },
      },
      { id: 'b', name: 'B', maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: true, reasoning: { effort: 'medium' } },
    ],
  }
  const [a, b] = parseModelCatalog(document, false)
  assert.deepEqual(a?.reasoning?.supportedEfforts, ['low', 'max'])
  assert.equal(a?.reasoning?.defaultEffort, 'high')
  assert.equal(a?.reasoning?.canDisableThinking, true)
  assert.equal(a?.reasoning?.onlyReasoning, true)
  assert.equal(b?.reasoning?.supportedEfforts, undefined)
  assert.equal(b?.reasoning?.defaultEffort, 'medium')
})

test('unknown effort spellings are dropped rather than passed through', () => {
  const document = {
    agents: [{ name: 'cli', models: ['a'] }],
    models: [
      { id: 'a', name: 'A', maxInputTokens: 1, maxOutputTokens: 1, supportsReasoning: true, reasoning: { supportedEfforts: ['low', 'minimal', 'off', 'turbo'] } },
    ],
  }
  assert.deepEqual(parseModelCatalog(document, false)[0]?.reasoning?.supportedEfforts, ['low'])
})

test('international windows use the default length, not the hard cap', () => {
  const document = {
    agents: [{ name: 'cli', models: ['a'] }],
    models: [
      {
        id: 'a',
        name: 'A',
        maxInputTokens: 1000000,
        maxOutputTokens: 128000,
        contextWindow: { defaultLength: 300000, supportedLengths: [300000, 1000000] },
      },
    ],
  }
  assert.equal(parseModelCatalog(document, true)[0]?.contextWindow, 300000)
  // The same row read as a CN document has no window object to honor.
  assert.equal(parseModelCatalog(document, false)[0]?.contextWindow, 1000000)
})

test('duplicate display names are disambiguated from the id', () => {
  const document = {
    agents: [{ name: 'cli', models: ['hy3', 'hy3-x'] }],
    models: [
      { id: 'hy3', name: 'Hy3', maxInputTokens: 1, maxOutputTokens: 1 },
      { id: 'hy3-x', name: 'Hy3', maxInputTokens: 1, maxOutputTokens: 1 },
    ],
  }
  assert.deepEqual(parseModelCatalog(document, false).map(model => model.name), ['Hy3', 'Hy3-X'])
})

test('a document without a cli roster is an error, not an empty list', () => {
  assert.throws(() => parseModelCatalog({ agents: [{ name: 'chat', models: ['a'] }], models: [] }, false), /no cli agent models/u)
  assert.throws(() => parseModelCatalog({ agents: [{ name: 'cli', models: ['ghost'] }], models: [] }, false), /empty list/u)
})

test('a bare product document (no envelope) parses the same way', () => {
  assert.equal(parseModelCatalog(cliDocument, false).length, 2)
})
