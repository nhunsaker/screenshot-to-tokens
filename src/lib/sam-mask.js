// Decoder for SAM 3.1 `one_bit` masks from the Meta Model API (`metadata: {mask_encoding: "one_bit"}`).
// Wire form inside `<|mask;x=0;y=0;data=H,W,!payload|>`: the raster's height, width, then `!` and a base85 payload.
// The raster covers the detection's box (x1..x2, y1..y2 inclusive) in the request frame, row-major, 1 = object.
// Format as published by Meta in @meta-sam/parser (SAM License): base85 over the printable ASCII range minus the wire
// delimiters, a 5-digit length prefix, then a binary adaptive range coder with a 12-pixel causal context (two pixels
// to the left, five above, five two rows above). This is our own small reimplementation of the decoder only, so the
// pipeline needs no new dependency; test/nontext.test.js checks it against masks saved from real API calls.
// Plain JS, no imports.

const EXCLUDED = '"\\,;<>|'
const ALPHABET = (() => {
  let s = ''
  for (let c = 0x21; c <= 0x7e; c++) { const ch = String.fromCharCode(c); if (EXCLUDED.indexOf(ch) < 0) s += ch }
  return s
})()
const DIGIT = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DIGIT[ALPHABET.charCodeAt(i)] = i

const R = 85
const TOP = 1 << 24
const BOTTOM = 1 << 16
const U32 = 0xffffffff

function digit(ch) {
  const c = ch.charCodeAt(0)
  const v = c < 128 ? DIGIT[c] : -1
  if (v < 0 || v >= R) throw new Error('mask: invalid base85 character')
  return v
}

/** Base85 text (5-digit length prefix, 5 digits per 4 bytes, short tail) -> bytes. Exported for tests. */
export function unpack85(s) {
  if (s.length < 5) throw new Error('mask: payload too short')
  let len = 0
  for (let i = 0; i < 5; i++) len = len * R + digit(s[i])
  const rem = len % 4
  const expected = 5 + Math.floor(len / 4) * 5 + (rem ? rem + 1 : 0)
  if (s.length !== expected) throw new Error(`mask: payload length ${s.length} != ${expected}`)
  const out = new Uint8Array(len)
  let src = 5
  let dst = 0
  for (; dst < len - rem; dst += 4, src += 5) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * R + digit(s[src + i])
    out[dst] = (v >>> 24) & 255; out[dst + 1] = (v >>> 16) & 255; out[dst + 2] = (v >>> 8) & 255; out[dst + 3] = v & 255
  }
  if (rem) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * R + (i < rem + 1 ? digit(s[src + i]) : R - 1)
    for (let i = 0; i < rem; i++) out[dst + i] = (v >>> (24 - i * 8)) & 255
  }
  return out
}

/** Carry-less range decoder (32-bit low/range, byte-wise renormalization). */
function rangeDecoder(bytes) {
  if (bytes.length < 4) throw new Error('mask: payload missing finalization')
  let pos = 0
  const read = () => { if (pos >= bytes.length) throw new Error('mask: payload ended early'); return bytes[pos++] }
  let low = 0, range = U32, code = 0, scaled = 0
  for (let i = 0; i < 4; i++) code = ((code << 8) | read()) >>> 0
  return {
    freq(total) {
      scaled = Math.floor(range / total)
      if (scaled === 0) throw new Error('mask: bad coder state')
      const v = Math.floor(((code - low) >>> 0) / scaled)
      return v >= total ? total - 1 : v
    },
    decode(cum, f) {
      low = (low + scaled * cum) >>> 0
      range = scaled * f
      for (;;) {
        if (((low ^ (low + range)) >>> 0) >= TOP) {
          if (range >= BOTTOM) break
          range = (-low >>> 0) & (BOTTOM - 1)
        }
        code = ((code << 8) | read()) >>> 0
        low = (low << 8) >>> 0
        range = (range << 8) >>> 0
      }
    },
  }
}

/**
 * Decode one `one_bit` payload (starting with "!") into a row-major Uint8Array of 0/1, width*height long.
 * @param {string} payload
 * @param {number} width
 * @param {number} height
 */
export function decodeOneBit(payload, width, height) {
  if (!payload || payload[0] !== '!') throw new Error('mask: not a one_bit payload (expected "!")')
  if (!(width > 0 && height > 0)) throw new Error('mask: bad dimensions')
  const dec = rangeDecoder(unpack85(payload.slice(1)))
  const counts = new Uint16Array(4096 * 2).fill(1)
  const pw = width + 4 // two pixels of zero padding on each side, two zero rows on top
  const pad = new Uint8Array(pw * (height + 2))
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = (y + 2) * pw + 2
    for (let x = 0; x < width; x++) {
      const p = row + x, a = p - pw, b = p - 2 * pw
      const ctx = pad[p - 1] | (pad[p - 2] << 1) | (pad[a - 2] << 2) | (pad[a - 1] << 3) | (pad[a] << 4) | (pad[a + 1] << 5) |
        (pad[a + 2] << 6) | (pad[b - 2] << 7) | (pad[b - 1] << 8) | (pad[b] << 9) | (pad[b + 1] << 10) | (pad[b + 2] << 11)
      const o = ctx << 1
      const zero = counts[o], one = counts[o + 1]
      const bit = dec.freq(zero + one) < zero ? 0 : 1
      if (bit) dec.decode(zero, one); else dec.decode(0, zero)
      pad[p] = bit
      out[y * width + x] = bit
      counts[o + bit] += 14
      if (counts[o] + counts[o + 1] >= 4096) { counts[o] = counts[o] >> 1 || 1; counts[o + 1] = counts[o + 1] >> 1 || 1 }
    }
  }
  return out
}

/**
 * Parse the mask token's `data` value ("H,W,!payload") and decode it.
 * @param {string} data
 * @returns {{width:number, height:number, bits:Uint8Array}}
 */
export function decodeMaskData(data) {
  const m = String(data).match(/^(\d+),(\d+),(.+)$/s)
  if (!m) throw new Error('mask: expected "H,W,payload"')
  const height = Number(m[1]), width = Number(m[2])
  if (m[3][0] === '~') throw new Error('mask: lossless encoding not supported (request mask_encoding "one_bit")')
  return { width, height, bits: decodeOneBit(m[3], width, height) }
}

/** Bytes -> base85 text with the 5-digit length prefix (inverse of unpack85). */
export function pack85(bytes) {
  let n = bytes.length
  const out = new Array(5)
  for (let i = 4; i >= 0; i--) { out[i] = ALPHABET[n % R]; n = Math.floor(n / R) }
  const five = (v, k) => {
    const d = new Array(5)
    for (let i = 4; i >= 0; i--) { d[i] = v % R; v = (v - d[i]) / R }
    for (let i = 0; i < k; i++) out.push(ALPHABET[d[i]])
  }
  const full = bytes.length - (bytes.length % 4)
  let o = 0
  for (; o < full; o += 4) five(((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0, 5)
  const rem = bytes.length - o
  if (rem) {
    let v = 0
    for (let i = 0; i < 4; i++) v = ((v << 8) | (i < rem ? bytes[o + i] : 0)) >>> 0
    five(v, rem + 1)
  }
  return out.join('')
}

/**
 * Encode a 0/1 raster as a `one_bit` payload (the inverse of decodeOneBit). Used by tests to build synthetic masks
 * and to check that a decoded API mask re-encodes to exactly the payload we received (a canonical round trip).
 */
export function encodeOneBit(bits, width, height) {
  const out = []
  let low = 0, range = U32
  const enc = (cum, f, total) => {
    const s = Math.floor(range / total)
    low = (low + s * cum) >>> 0
    range = s * f
    for (;;) {
      if (((low ^ (low + range)) >>> 0) >= TOP) {
        if (range >= BOTTOM) break
        range = (-low >>> 0) & (BOTTOM - 1)
      }
      out.push((low >>> 24) & 255)
      low = (low << 8) >>> 0
      range = (range << 8) >>> 0
    }
  }
  const counts = new Uint16Array(4096 * 2).fill(1)
  const pw = width + 4
  const pad = new Uint8Array(pw * (height + 2))
  for (let y = 0; y < height; y++) {
    const row = (y + 2) * pw + 2
    for (let x = 0; x < width; x++) {
      const p = row + x, a = p - pw, b = p - 2 * pw
      const ctx = pad[p - 1] | (pad[p - 2] << 1) | (pad[a - 2] << 2) | (pad[a - 1] << 3) | (pad[a] << 4) | (pad[a + 1] << 5) |
        (pad[a + 2] << 6) | (pad[b - 2] << 7) | (pad[b - 1] << 8) | (pad[b] << 9) | (pad[b + 1] << 10) | (pad[b + 2] << 11)
      const o = ctx << 1
      const zero = counts[o], one = counts[o + 1]
      const bit = bits[y * width + x] ? 1 : 0
      if (bit) enc(zero, one, zero + one); else enc(0, zero, zero + one)
      pad[p] = bit
      counts[o + bit] += 14
      if (counts[o] + counts[o + 1] >= 4096) { counts[o] = counts[o] >> 1 || 1; counts[o + 1] = counts[o + 1] >> 1 || 1 }
    }
  }
  for (let i = 0; i < 4; i++) { out.push((low >>> 24) & 255); low = (low << 8) >>> 0 }
  return '!' + pack85(Uint8Array.from(out))
}
