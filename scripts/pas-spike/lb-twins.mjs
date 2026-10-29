// Spike test 3: twins on Light Bootstrap (a second theme). Each click goes through pointAt() (SAM 3.1 point prompt,
// own colour from the outline, twins by ΔE < 6 + size against the run's hybrid regions). `expect` lists the regions a
// person would call look-alikes (checked on the screenshot); `otherColour` lists same-kind, same-size regions of a
// different colour (any of those in the twin list is a false twin across colours).
// Usage: node scripts/pas-spike/lb-twins.mjs [run]
import { writeFileSync } from 'fs'
import { loadDotEnv } from '../../src/config.js'
import { loadPointContext, pointAt } from '../../src/stages/pas/point.js'

loadDotEnv()
const run = process.argv[2] || 'out/pas-spike/lb'
const CARD_ICONS = ['r74', 'r61', 'r57', 'r56'] // orange chart, green lamp, red vector, blue heart (all ~46 px)
const CLICKS = [
  { name: 'sidebar icon (User profile)', x: 45, y: 161, expect: ['r62', 'r68', 'r60', 'r65', 'r66', 'r75', 'r69'], otherColour: CARD_ICONS },
  { name: 'card icon orange (Number)', x: 345, y: 153, expect: [], otherColour: CARD_ICONS.filter((r) => r !== 'r74') },
  { name: 'card icon green (Revenue)', x: 631, y: 153, expect: [], otherColour: CARD_ICONS.filter((r) => r !== 'r61') },
  { name: 'card icon red (Errors)', x: 919, y: 153, expect: [], otherColour: CARD_ICONS.filter((r) => r !== 'r57') },
  { name: 'card icon blue (Followers)', x: 1207, y: 153, expect: [], otherColour: CARD_ICONS.filter((r) => r !== 'r56') },
  { name: 'small grey refresh icon (Update Now)', x: 314, y: 220, expect: ['r70', 'r76', 'r67'], otherColour: [] },
  { name: 'top nav link (Account)', x: 1161, y: 38, expect: ['r17', 'r14', 'r11'], otherColour: ['r13'] },
]

const ctx = loadPointContext(run)
const rows = []
for (const c of CLICKS) {
  const r = await pointAt(ctx, c.x, c.y)
  const ids = r.twins.map((t) => t.id)
  const falseAcross = ids.filter((id) => c.otherColour.includes(id))
  const found = ids.filter((id) => c.expect.includes(id))
  rows.push({ ...c, sam: r.sam, region: r.region, outline: r.outline, own: r.own, twins: r.twins, near: r.near, falseAcrossColours: falseAcross, expectedFound: found })
  console.log(`${c.name}: region ${r.region ? r.region.id + ' ' + r.region.label : 'none'}; own ${r.own && r.own.hex} (ring ${r.own && r.own.ring}); SAM ${r.sam.ms} ms ${r.sam.source} outline ${r.outline && JSON.stringify(r.outline.bbox)}`)
  console.log(`   twins: ${r.twins.map((t) => `${t.id} ${t.hex} dE ${t.deltaE}`).join(', ') || 'none'}; near (dE 6-15): ${r.near.map((t) => `${t.id} ${t.hex} dE ${t.deltaE}`).join(', ') || 'none'}; false across colours: ${falseAcross.length}; expected found: ${found.length}/${c.expect.length}`)
}
writeFileSync('out/pas-spike/lb-twins.json', JSON.stringify(rows, null, 2))
