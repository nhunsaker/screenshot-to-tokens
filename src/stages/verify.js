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

/** Pixels pixelmatch painted with its diff color (pure red) in an output buffer. */
function changedMask(out) {
  const mask = new Uint8Array(out.length / 4)
  for (let i = 0; i < mask.length; i++) mask[i] = out[i * 4] === 255 && out[i * 4 + 1] === 0 && out[i * 4 + 2] === 0 ? 1 : 0
  return mask
}

/**
 * @param {string} beforePath @param {string} afterPath @param {string} diffPath @param {number} threshold
 * @param {string} [noisePath]  A second screenshot of the UNCHANGED page. Pixels that differ between two loads of
 *   the same page (randomized layouts, running animations, rotating content) are noise, not the rewrite: they're
 *   left out of the count and reported as `noisePixels`. Without it, every changed pixel counts.
 * @returns {import('../types.js').VerifyResult}
 */
export function compareScreenshots(beforePath, afterPath, diffPath, threshold, noisePath) {
  const before = readPng(beforePath)
  const after = readPng(afterPath)
  const noise = noisePath ? readPng(noisePath) : null
  const maxW = Math.max(before.width, after.width, noise ? noise.width : 0)
  const maxH = Math.max(before.height, after.height, noise ? noise.height : 0)

  const a = padWhite(before, maxW, maxH)
  const b = padWhite(after, maxW, maxH)
  const diff = new Uint8Array(maxW * maxH * 4)

  let diffPixels = pixelmatch(a, b, diff, maxW, maxH, { threshold: 0.1, includeAA: false })
  let noisePixels = 0
  if (noise) {
    const n = new Uint8Array(maxW * maxH * 4)
    pixelmatch(a, padWhite(noise, maxW, maxH), n, maxW, maxH, { threshold: 0.1, includeAA: false })
    const noisy = changedMask(n), changed = changedMask(diff)
    for (let i = 0; i < noisy.length; i++) {
      if (!noisy[i]) continue
      noisePixels++
      // Paint excluded pixels blue in the diff image so a reviewer can see what was left out.
      if (changed[i]) { diffPixels--; diff[i * 4] = 0; diff[i * 4 + 1] = 120; diff[i * 4 + 2] = 255 }
    }
  }
  const totalPixels = maxW * maxH
  const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0

  const png = new PNG({ width: maxW, height: maxH })
  png.data = Buffer.from(diff)
  writeFileSync(diffPath, PNG.sync.write(png))

  return {
    diffPixels,
    ...(noise ? { noisePixels } : {}),
    totalPixels,
    ratio,
    pass: ratio <= threshold,
    threshold,
    before: beforePath,
    after: afterPath,
    diff: diffPath,
  }
}
