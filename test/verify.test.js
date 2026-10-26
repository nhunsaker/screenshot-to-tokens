import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { compareScreenshots } from '../src/stages/verify.js'

/** Make a w x h white PNG, optionally painting a square black. */
function makePng(path, w, h, blackSquare) {
  const png = new PNG({ width: w, height: h })
  png.data.fill(255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (w * y + x) << 2
      png.data[idx + 3] = 255
    }
  }
  if (blackSquare) {
    const { x0, y0, x1, y1 } = blackSquare
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (w * y + x) << 2
        png.data[idx] = 0
        png.data[idx + 1] = 0
        png.data[idx + 2] = 0
        png.data[idx + 3] = 255
      }
    }
  }
  writeFileSync(path, PNG.sync.write(png))
}

test('compareScreenshots: identical images pass with zero diff', () => {
  const root = mkdtempSync(join(tmpdir(), 's2t-verify-'))
  const before = join(root, 'before.png')
  const after = join(root, 'after.png')
  const diff = join(root, 'diff.png')
  makePng(before, 10, 10)
  makePng(after, 10, 10)

  const r = compareScreenshots(before, after, diff, 0.01)
  assert.equal(r.diffPixels, 0)
  assert.equal(r.ratio, 0)
  assert.equal(r.pass, true)
  assert.equal(r.totalPixels, 100)
  assert.equal(r.before, before)
  assert.equal(r.after, after)
  assert.equal(r.diff, diff)

  rmSync(root, { recursive: true, force: true })
})

test('compareScreenshots: a changed block raises the ratio above threshold and fails', () => {
  const root = mkdtempSync(join(tmpdir(), 's2t-verify-'))
  const before = join(root, 'before.png')
  const after = join(root, 'after.png')
  const diff = join(root, 'diff.png')
  makePng(before, 10, 10)
  makePng(after, 10, 10, { x0: 0, y0: 0, x1: 4, y1: 4 }) // 16 of 100 px changed

  const r = compareScreenshots(before, after, diff, 0.01)
  assert.ok(r.ratio > 0, 'ratio should be > 0 when a block changed')
  assert.equal(r.diffPixels, 16)
  assert.equal(r.pass, false) // 0.16 > 0.01 threshold
})

test('compareScreenshots: different sizes are padded with white, padding counts as diff', () => {
  const root = mkdtempSync(join(tmpdir(), 's2t-verify-'))
  const before = join(root, 'before.png')
  const after = join(root, 'after.png')
  const diff = join(root, 'diff.png')
  // before is 10x10 with a black square only in the bottom-right corner (outside the 8x8 after image).
  makePng(before, 10, 10, { x0: 8, y0: 8, x1: 10, y1: 10 })
  makePng(after, 8, 8)

  const r = compareScreenshots(before, after, diff, 0)
  assert.equal(r.totalPixels, 100) // padded to the 10x10 max
  assert.ok(r.diffPixels > 0, 'padding region mismatch should be counted')
  assert.equal(r.pass, false)

  rmSync(root, { recursive: true, force: true })
})
