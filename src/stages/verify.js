// Verify: pixel-diff the before/after screenshots. Different sizes are padded to the max
// width/height with white (RGBA 255,255,255,255); the padding itself counts toward the diff,
// so a rewrite that changes layout size doesn't silently pass.
import { readFileSync, writeFileSync } from 'fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

/** Read a PNG file into {width, height, data}. */
function readPng(path) {
  return PNG.sync.read(readFileSync(path))
}

/** Pad an image's RGBA data into a maxW x maxH buffer, filled white, top-left aligned. */
function padWhite(img, maxW, maxH) {
  const out = new Uint8Array(maxW * maxH * 4).fill(255)
  const rowBytes = img.width * 4
  for (let y = 0; y < img.height; y++) {
    const srcStart = y * rowBytes
    const dstStart = y * maxW * 4
    out.set(img.data.subarray(srcStart, srcStart + rowBytes), dstStart)
  }
  return out
}

/**
 * @param {string} beforePath @param {string} afterPath @param {string} diffPath @param {number} threshold
 * @returns {import('../types.js').VerifyResult}
 */
export function compareScreenshots(beforePath, afterPath, diffPath, threshold) {
  const before = readPng(beforePath)
  const after = readPng(afterPath)
  const maxW = Math.max(before.width, after.width)
  const maxH = Math.max(before.height, after.height)

  const a = padWhite(before, maxW, maxH)
  const b = padWhite(after, maxW, maxH)
  const diff = new Uint8Array(maxW * maxH * 4)

  const diffPixels = pixelmatch(a, b, diff, maxW, maxH, { threshold: 0.1, includeAA: false })
  const totalPixels = maxW * maxH
  const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0

  const png = new PNG({ width: maxW, height: maxH })
  png.data = Buffer.from(diff)
  writeFileSync(diffPath, PNG.sync.write(png))

  return {
    diffPixels,
    totalPixels,
    ratio,
    pass: ratio <= threshold,
    threshold,
    before: beforePath,
    after: afterPath,
    diff: diffPath,
  }
}
