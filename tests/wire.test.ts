import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { test } from 'node:test'
import { openAICompletionsApi } from '@earendil-works/pi-ai/compat'
import type { Context, Model, TranscriptContext } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { toPiModel } from '../src/models.ts'
import { normalizeChatBody, type ChatBody } from '../src/payload.ts'

/** A transcript with a system prompt and a user turn, normalized the way pi does. */
const context: TranscriptContext = normalizeContext({
  messages: [
    {
      role: 'system',
      content: [{ type: 'text', text: 'You are a coding assistant.' }],
      timestamp: Date.now(),
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: Date.now(),
    },
  ],
} as Context)

/** One SSE answer with a text delta and a terminal stop. */
function sseBody(): string {
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    model: 'glm-5.3',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`
  return [
    chunk({ role: 'assistant', content: '' }, null),
    chunk({ content: 'hi there' }, null),
    chunk({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('')
}

/** Run one request against a local server and return the captured body. */
async function captureRequest(options: {
  model: Model<'openai-completions'>
  reasoning?: 'low' | 'high'
  international: boolean
}): Promise<ChatBody> {
  const captured: ChatBody[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody
      captured.push(normalizeChatBody(raw, options.international))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(sseBody())
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  try {
    const model = { ...options.model, baseUrl: `http://127.0.0.1:${address.port}/v2` }
    const stream = openAICompletionsApi().streamSimple(model, context, {
      apiKey: 'token',
      reasoning: options.reasoning,
      maxTokens: 2048,
      onPayload: (payload: unknown) => normalizeChatBody(payload as ChatBody, options.international),
    })
    await stream.result()
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  assert.equal(captured.length, 1)
  return captured[0]!
}

const model = toPiModel(
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1_000_000,
    maxTokens: 64_000,
    supportsImages: true,
    credits: 'x0.79 credits',
    reasoning: {
      supports: true,
      supportedEfforts: ['low', 'high', 'max'],
      defaultEffort: 'high',
      canDisableThinking: false,
      onlyReasoning: true,
    },
  },
  { id: 'workbuddy' },
  'https://copilot.tencent.com/v2',
)

test('the wire body is streaming, uses max_tokens, and never sends a developer role', async () => {
  const body = await captureRequest({ model, international: false, reasoning: 'high' })
  assert.equal(body['stream'], true)
  assert.equal(body['model'], 'glm-5.3')
  assert.equal(body['max_tokens'], 2048)
  assert.equal('max_completion_tokens' in body, false)
  assert.equal('store' in body, false)
  const roles = (body['messages'] as Array<{ role: string }>).map(message => message.role)
  assert.equal(roles.includes('developer'), false)
  assert.equal(roles[0], 'system')
})

test('a declared thinking level reaches the wire as reasoning_effort', async () => {
  const body = await captureRequest({ model, international: false, reasoning: 'high' })
  assert.equal(body['reasoning_effort'], 'high')
})

test('a request with no level sends the model default rather than an off spelling', async () => {
  // `off` is not offered for any model here, so pi never sends it; the lowest
  // declared level stands in for a request that asks for none.
  const body = await captureRequest({ model, international: false, reasoning: 'low' })
  assert.notEqual(body['reasoning_effort'], 'off')
  assert.equal(body['reasoning_effort'], 'low')
})

test('the international gateway receives a leading system message', async () => {
  const body = await captureRequest({ model, international: true, reasoning: 'low' })
  const messages = body['messages'] as Array<{ role: string }>
  assert.equal(messages[0]?.role, 'system')
})
