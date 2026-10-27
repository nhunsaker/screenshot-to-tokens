// sorb-preview.js is a plain browser script; run it in a vm with a small fake DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../src/preview-client/sorb-preview.js', import.meta.url), 'utf-8')

function fakeEl(tag) {
  const attrs = {}
  return {
    tagName: tag.toUpperCase(), style: { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }, children: [], textContent: '', innerHTML: '',
    setAttribute(k, v) { attrs[k] = String(v) }, getAttribute(k) { return k in attrs ? attrs[k] : null }, removeAttribute(k) { delete attrs[k] },
    appendChild(c) { this.children.push(c); return c },
  }
}

/** Run the script with a URL query, script attributes, existing <link> hrefs and a system dark preference. */
function run({ search = '', attrs = {}, links = [], systemDark = false } = {}) {
  const root = fakeEl('html'), head = fakeEl('head'), body = fakeEl('body')
  const script = fakeEl('script')
  for (const k of Object.keys(attrs)) script.setAttribute(k, attrs[k])
  const linkEls = links.map((h) => { const l = fakeEl('link'); l.setAttribute('rel', 'stylesheet'); l.setAttribute('href', h); return l })
  const byId = () => body.children.concat(head.children)
  const document = {
    currentScript: script, documentElement: root, head, body, readyState: 'complete',
    createElement: fakeEl, addEventListener() {},
    querySelectorAll: (q) => (/link/.test(q) ? linkEls.concat(head.children.filter((c) => c.tagName === 'LINK')) : []),
    getElementById: (id) => byId().find((c) => c.id === id) || null,
  }
  const ctx = {
    document, location: { search, hash: '' }, URLSearchParams, setInterval() {}, fetch: () => Promise.resolve({ ok: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    window: { matchMedia: () => ({ matches: systemDark }) },
  }
  vm.runInNewContext(SRC, ctx)
  return { root, head, body, button: document.getElementById('sorb-theme-toggle') }
}

test('sorb-preview: nothing happens without a proposal, a theme param or a dark stylesheet', () => {
  const r = run()
  assert.equal(r.button, null)
  assert.equal(r.root.getAttribute('data-theme'), null)
  assert.equal(r.head.children.length, 0)
})

test('sorb-preview: data-dark-css loads tokens.dark.css and shows a theme button that flips data-theme', () => {
  const r = run({ attrs: { 'data-dark-css': 'tokens.dark.css' } })
  const link = r.head.children.find((c) => c.tagName === 'LINK')
  assert.equal(link.getAttribute('href'), 'tokens.dark.css')
  assert.ok(r.button, 'button shown')
  assert.equal(r.button.textContent, 'Dark theme (proposal): off')
  r.button.onclick()
  assert.equal(r.root.getAttribute('data-theme'), 'dark')
  assert.equal(r.button.getAttribute('aria-pressed'), 'true')
  assert.equal(r.button.textContent, 'Dark theme (proposal): on')
  r.button.onclick()
  assert.equal(r.root.getAttribute('data-theme'), 'light')
})

test('sorb-preview: ?theme=dark sets data-theme; an existing <link> to tokens.dark.css is reused, not duplicated', () => {
  const r = run({ search: '?theme=dark', links: ['css/tokens.dark.css'] })
  assert.equal(r.root.getAttribute('data-theme'), 'dark')
  assert.equal(r.head.children.length, 0)
  assert.equal(r.button.textContent, 'Dark theme (proposal): on')
})

test('sorb-preview: the button starts from the system setting when no data-theme is set', () => {
  const r = run({ links: ['tokens.dark.css'], systemDark: true })
  assert.equal(r.root.getAttribute('data-theme'), null)
  assert.equal(r.button.textContent, 'Dark theme (proposal): on')
  r.button.onclick()
  assert.equal(r.root.getAttribute('data-theme'), 'light')
})

test('sorb-preview: an unsafe data-dark-css or theme value is ignored', () => {
  const r = run({ search: '?theme=evil', attrs: { 'data-dark-css': 'javascript:alert(1)' } })
  assert.equal(r.head.children.length, 0)
  assert.equal(r.button, null)
  assert.equal(r.root.getAttribute('data-theme'), null)
  const r2 = run({ attrs: { 'data-dark-css': 'https://evil.example/x.css' } })
  assert.equal(r2.head.children.length, 0)
  assert.equal(run({ attrs: { 'data-dark-css': '//evil.example/x.css' } }).head.children.length, 0, 'protocol-relative URL ignored')
  assert.equal(run({ attrs: { 'data-dark-css': '/tokens.dark.css' } }).head.children.length, 1, 'site-absolute path allowed')
})
