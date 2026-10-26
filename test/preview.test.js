import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toSorbTokens, proposePreview, writeSorbConfig } from '../src/stages/preview.js'

const clusters = [
  { id: 'color-01', kind: 'color' },
  { id: 'radius-01', kind: 'radius' },
  { id: 'shadow-01', kind: 'shadow' },
]

const tokenSet = {
  namer: 'mock',
  tokens: [
    { name: 'color.blue.600', tier: 'primitive', value: '#1a73e8ff', clusters: ['color-01'], why: '' },
    { name: 'color.action.primary', tier: 'semantic', alias: 'color.blue.600', clusters: ['color-01'], why: '' },
    { name: 'button.radius', tier: 'component', alias: 'radius.sm', clusters: ['radius-01'], why: '' },
    { name: 'radius.sm', tier: 'primitive', value: '4px', clusters: ['radius-01'], why: '' },
    { name: 'card.shadow', tier: 'component', value: '0 1px 3px rgba(0,0,0,.1)', clusters: ['shadow-01'], why: '' },
    { name: 'orphan.token', tier: 'semantic', alias: 'nowhere', clusters: [], why: '' },
  ],
}

test('toSorbTokens: primitive gets its own value, strips hex alpha ff', () => {
  const out = toSorbTokens(tokenSet, clusters)
  const blue = out.find((t) => t.id === 'color.blue.600')
  assert.equal(blue.cssVar, '--color-blue-600')
  assert.equal(blue.value, '#1a73e8')
  assert.equal(blue.tier, 'primitive')
  assert.equal(blue.type, 'color')
})

test('toSorbTokens: semantic/component aliases resolve to the primitive literal', () => {
  const out = toSorbTokens(tokenSet, clusters)
  const action = out.find((t) => t.id === 'color.action.primary')
  assert.equal(action.value, '#1a73e8') // resolved through the alias chain, no var()
  assert.equal(action.tier, 'semantic')
  const radius = out.find((t) => t.id === 'button.radius')
  assert.equal(radius.value, '4px')
  assert.equal(radius.type, 'dimension')
})

test('toSorbTokens: shadow kind has no DTCG $type match, falls back to string', () => {
  const out = toSorbTokens(tokenSet, clusters)
  const shadow = out.find((t) => t.id === 'card.shadow')
  assert.equal(shadow.type, 'string')
})

test('toSorbTokens: no clusters passed -> every type falls back to string', () => {
  const out = toSorbTokens(tokenSet)
  assert.ok(out.every((t) => t.type === 'string'))
  assert.equal(out.length, tokenSet.tokens.length)
})

test('toSorbTokens: unresolved alias (no matching token) yields empty-string value, never throws', () => {
  const out = toSorbTokens(tokenSet, clusters)
  const orphan = out.find((t) => t.id === 'orphan.token')
  assert.equal(orphan.value, '')
})

test('proposePreview: rejects when neither tokens nor tokenName+value is given (no network)', async () => {
  await assert.rejects(() => proposePreview({ bridgeUrl: 'http://localhost:7777' }), /needs either/)
})

test('proposePreview: rejects when bridgeUrl is missing (no network)', async () => {
  await assert.rejects(() => proposePreview({ tokenName: 'color.action.primary', value: '#000' }), /needs \{bridgeUrl\}/)
})

test('writeSorbConfig: writes the sorb-init shape with defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-preview-'))
  const result = writeSorbConfig(dir, { appUrl: 'http://localhost:3000' })
  assert.equal(result.written, true)
  assert.ok(existsSync(result.path))
  const config = JSON.parse(readFileSync(result.path, 'utf-8'))
  assert.equal(config.namespace, 's2t-demo')
  assert.deepEqual(config.tokenSources, ['tokens.json'])
  assert.equal(config.port, 7777)
  assert.equal(config.appUrl, 'http://localhost:3000')
})

test('writeSorbConfig: respects a custom namespace/tokenSources/port', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-preview-'))
  const result = writeSorbConfig(dir, { namespace: 'acme-shop', tokenSources: ['out/run1/tokens.json'], port: 8080 })
  const config = JSON.parse(readFileSync(result.path, 'utf-8'))
  assert.equal(config.namespace, 'acme-shop')
  assert.deepEqual(config.tokenSources, ['out/run1/tokens.json'])
  assert.equal(config.port, 8080)
})

test('writeSorbConfig: refuses to clobber an existing config unless overwrite:true', () => {
  const dir = mkdtempSync(join(tmpdir(), 's2t-preview-'))
  const first = writeSorbConfig(dir, { namespace: 'first' })
  assert.equal(first.written, true)
  const second = writeSorbConfig(dir, { namespace: 'second' })
  assert.equal(second.written, false)
  const stillFirst = JSON.parse(readFileSync(second.path, 'utf-8'))
  assert.equal(stillFirst.namespace, 'first')
  const third = writeSorbConfig(dir, { namespace: 'third', overwrite: true })
  assert.equal(third.written, true)
  const nowThird = JSON.parse(readFileSync(third.path, 'utf-8'))
  assert.equal(nowThird.namespace, 'third')
})
