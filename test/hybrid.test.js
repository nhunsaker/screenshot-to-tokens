import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutRegions, mergeRegions, relabelInertButtons } from '../src/providers/segment/hybrid.js'
import { labelFor, regionsFromCapture } from '../src/providers/segment/mock.js'

const R = (id, label, bbox, source) => ({ id, label, bbox, score: 1, source })
const el = (i, bbox, bg = 'rgba(0, 0, 0, 0)') => ({ i, tag: 'div', path: 'div', role: null, text: '', bbox, styles: { 'background-color': bg } })

const capture = {
  viewport: { width: 1440, height: 900 },
  elements: [
    el(0, [0, 0, 220, 900], 'rgb(27, 31, 42)'),   // dark sidebar
    el(1, [220, 0, 1220, 935]),                   // page wrapper (too tall for a header)
    el(2, [248, 24, 1164, 35]),                   // toolbar row
    el(3, [248, 24, 953, 35], 'rgb(255, 255, 255)'),
  ],
}
const sam = [
  R('s1', 'input', [249, 24, 950, 34], 'sam3.1'),
  R('s2', 'button', [1217, 24, 69, 35], 'sam3.1'),
  R('s3', 'button', [1302, 25, 110, 33], 'sam3.1'),
]

test('layoutRegions: toolbar holding 2+ SAM regions is a header; filled left column is a nav', () => {
  const out = layoutRegions(capture, sam)
  assert.deepEqual(out.find((r) => r.label === 'header').bbox, [248, 24, 1164, 35])
  assert.deepEqual(out.find((r) => r.label === 'nav').bbox, [0, 0, 220, 900])
  assert.ok(out.every((r) => r.source === 'layout'))
})

test('layoutRegions: no header without SAM anchors', () => {
  assert.equal(layoutRegions(capture, []).filter((r) => r.label === 'header').length, 0)
})

test('mergeRegions: SAM wins overlaps, DOM fills the rest, nested pairs survive', () => {
  const dom = [
    R('d1', 'badge', [1218, 24, 68, 35], 'mock-dom'),     // the same box SAM called a button → dropped
    R('d2', 'card', [248, 83, 279, 108], 'mock-dom'),     // nothing else there → kept
  ]
  const layout = layoutRegions(capture, sam)
  const out = mergeRegions(sam, layout, dom)
  const labels = out.map((r) => `${r.label}:${r.source}`).sort()
  assert.ok(labels.includes('button:sam3.1'))
  assert.ok(!labels.includes('badge:mock-dom'))
  assert.ok(labels.includes('card:mock-dom'))
  assert.ok(labels.includes('header:layout') && labels.includes('nav:layout'))
  assert.equal(new Set(out.map((r) => r.id)).size, out.length)
})

test('relabelInertButtons: a small SAM "button" over a non-clickable element becomes a badge', () => {
  const sam = [
    { id: 's0', bbox: [629, 809, 48, 18], label: 'button', score: 0.9, source: 'sam3.1' }, // status pill
    { id: 's1', bbox: [1338, 851, 56, 26], label: 'button', score: 0.9, source: 'sam3.1' }, // real "View" button
    { id: 's2', bbox: [500, 300, 80, 30], label: 'button', score: 0.9, source: 'sam3.1' }, // painted in a canvas
  ]
  const capture = { viewport: { width: 1440, height: 900 }, elements: [
    { bbox: [629, 809, 50, 19], clickable: false },
    { bbox: [1338, 851, 58, 27], clickable: true },
    { bbox: [400, 200, 600, 400], clickable: false }, // the canvas: too big to match the painted button
  ] }
  const out = relabelInertButtons(sam, capture)
  assert.deepEqual(out.map((r) => r.label), ['badge', 'button', 'button'])
  assert.equal(out[0].source, 'sam3.1+inert')
  // Older captures (no clickable field) are left alone.
  assert.equal(relabelInertButtons(sam, { elements: [{ bbox: [629, 809, 50, 19] }] })[0].label, 'button')
})

test('mock: a filled, tappable link is a button even without padding; off-screen elements are skipped', () => {
  const join = { role: 'link', bbox: [823, 109, 183, 45], styles: { 'background-color': 'rgb(1, 158, 24)', 'padding-left': '5px', 'padding-top': '0px' } }
  const inline = { role: 'link', bbox: [374, 751, 112, 22], styles: { 'background-color': 'rgb(1, 158, 24)' } }
  assert.equal(labelFor(join), 'button')
  assert.equal(labelFor(inline), 'link')
  const skip = { role: 'link', bbox: [1440, 16, 88, 95], styles: {} }
  assert.equal(regionsFromCapture({ viewport: { width: 1440, height: 900 }, elements: [skip, join] }).length, 1)
})
