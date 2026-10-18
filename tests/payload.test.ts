import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeChatBody } from '../src/payload.ts'

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'glm-5.3',
    stream: false,
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ],
    ...overrides,
  }
}

test('streaming is forced: the upstream rejects non-streaming requests', () => {
  assert.equal(normalizeChatBody(body(), false)['stream'], true)
})

test('developer messages become system messages', () => {
  const result = normalizeChatBody(body({
    messages: [{ role: 'developer', content: 'rules' }, { role: 'user', content: 'hi' }],
  }), false)
  assert.deepEqual((result['messages'] as Array<{ role: string }>).map(message => message.role), ['system', 'user'])
})

test('an off reasoning effort is stripped rather than sent', () => {
  assert.equal('reasoning_effort' in normalizeChatBody(body({ reasoning_effort: 'off' }), false), false)
  assert.equal(normalizeChatBody(body({ reasoning_effort: 'high' }), false)['reasoning_effort'], 'high')
})

test('the international gateway gets a leading system message, prepended not merged', () => {
  const result = normalizeChatBody(body({
    messages: [{ role: 'user', content: 'hi' }],
  }), true)
  const messages = result['messages'] as Array<{ role: string; content: string }>
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.role, 'system')
  assert.equal(messages[1]?.content, 'hi')
})

test('an existing leading system message is left alone', () => {
  const result = normalizeChatBody(body(), true)
  const messages = result['messages'] as Array<{ role: string; content: string }>
  assert.equal(messages.length, 2)
  assert.equal(messages[0]?.content, 'You are helpful.')
})

test('the CN endpoint is not given an extra system message', () => {
  const result = normalizeChatBody(body({ messages: [{ role: 'user', content: 'hi' }] }), false)
  assert.equal((result['messages'] as unknown[]).length, 1)
})
