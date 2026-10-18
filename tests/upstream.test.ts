import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatUserAgent, parseCycleEndTime, validAppVersion } from '../src/upstream.ts'
import { AI_VARIANT, CN_VARIANT, regionOf } from '../src/variants.ts'

test('regions follow the login domain', () => {
  assert.equal(regionOf('www.workbuddy.ai'), 'global')
  assert.equal(regionOf('workbuddy.ai'), 'global')
  assert.equal(regionOf('www.workbuddy.cn'), 'cn')
  assert.equal(regionOf(''), 'cn')
})

test('the chat User-Agent is the desktop shape, per region', () => {
  assert.equal(chatUserAgent({ appVersion: '5.8.3' }, 'cn'), 'WorkBuddy/5.8.3 WorkBuddy/5.8.3')
  assert.equal(chatUserAgent({ appVersion: '5.8.4' }, 'global'), 'WorkBuddy/5.8.4 WorkBuddy AI/5.8.4')
  assert.equal(
    chatUserAgent({ appVersion: '5.8.3', cliVersion: '2.161.0' }, 'cn'),
    'WorkBuddy/5.8.3 WorkBuddy/5.8.3 CLI/2.161.0',
  )
})

test('an invalid version fails instead of reaching a header', () => {
  assert.throws(() => chatUserAgent({ appVersion: '5.8\r\nX-Evil: 1' }, 'cn'), /invalid app version/u)
  assert.equal(validAppVersion('5.8.3'), true)
  assert.equal(validAppVersion('5.8'), true)
  assert.equal(validAppVersion('5.8.3.1'), true)
  assert.equal(validAppVersion('5.8.3 '), false)
  assert.equal(validAppVersion('v5.8.3'), false)
})

test('cycle end times parse and reject impossible dates', () => {
  const parsed = parseCycleEndTime('2026-10-31 23:59:59')
  assert.equal(typeof parsed, 'number')
  assert.equal(new Date(parsed!).getFullYear(), 2026)
  assert.equal(parseCycleEndTime('2026-02-30 00:00:00'), undefined)
  assert.equal(parseCycleEndTime('not a date'), undefined)
  assert.equal(parseCycleEndTime(undefined), undefined)
})

test('both variants name their own app and auth file', () => {
  assert.equal(CN_VARIANT.desktopFilename, 'workbuddy-desktop.info')
  assert.equal(AI_VARIANT.desktopFilename, 'workbuddy-desktop-ai.info')
  assert.notEqual(CN_VARIANT.ownFilename, AI_VARIANT.ownFilename)
  assert.notEqual(CN_VARIANT.electronEnv, AI_VARIANT.electronEnv)
})
