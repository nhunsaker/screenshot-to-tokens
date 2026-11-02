import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { checkUrl, blockedAddress, embeddedV4, resolvePublic, validatePublicUrl, followRedirects, publicLookup } from '../src/lib/public-url.js'

test('blockedAddress: private, loopback, link-local, CGNAT, multicast, metadata, reserved', () => {
  for (const ip of ['127.0.0.1', '127.8.8.8', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '169.254.1.1',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.250', '255.255.255.255', '240.0.0.1', '198.18.0.1', '192.0.2.5']) {
    assert.ok(blockedAddress(ip), ip)
  }
  assert.match(blockedAddress('169.254.169.254'), /metadata/)
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1']) {
    assert.ok(blockedAddress(ip), ip)
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '185.199.108.153', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '2a01:4f8::1']) {
    assert.equal(blockedAddress(ip), null, ip)
  }
  assert.match(blockedAddress('5.78.129.14'), /own server/)
})

test('embeddedV4 finds mapped, NAT64 and 6to4 addresses', () => {
  assert.equal(embeddedV4('::ffff:7f00:1'), '127.0.0.1')
  assert.equal(embeddedV4('::ffff:127.0.0.1'), '127.0.0.1')
  assert.equal(embeddedV4('64:ff9b::808:808'), '8.8.8.8')
  assert.equal(embeddedV4('2002:a00:1::1'), '10.0.0.1')
  assert.equal(embeddedV4('2606:4700::1111'), null)
  assert.equal(embeddedV4('::1'), null)
})

test('checkUrl: scheme, port, credentials, local names, own host, IP literals', () => {
  const bad = ['', 'file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'http://localhost:3000', 'http://localhost/',
    'http://foo.localhost/', 'http://printer.local/', 'http://intranet/', 'http://127.0.0.1', 'http://2130706433/', 'http://0x7f.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/', 'http://10.0.0.1', 'https://example.com:8443/',
    'http://user:pw@example.com/', 'https://s2t.sorbcloud.com/', 'https://www.s2t.sorbcloud.com/', 'http://5.78.129.14/',
    'data:text/html,hi', 'http://db.internal/']
  for (const u of bad) assert.equal(checkUrl(u).ok, false, u)
  for (const u of ['https://example.com', 'http://example.com:80/x', 'https://example.com:443/', 'gaotianchi.github.io', 'https://8.8.8.8/']) {
    assert.equal(checkUrl(u).ok, true, u)
  }
  assert.equal(checkUrl('gaotianchi.github.io').url.href, 'https://gaotianchi.github.io/')
})

const fakeLookup = (table) => async (host) => {
  if (!(host in table)) { const e = new Error('nx'); e.code = 'ENOTFOUND'; throw e }
  return table[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}

test('resolvePublic refuses if ANY address is private (A and AAAA)', async () => {
  const lookup = fakeLookup({ 'ok.example': ['185.199.108.153', '2606:50c0:8000::153'], 'mixed.example': ['8.8.8.8', '10.0.0.5'],
    'v6.example': ['8.8.8.8', 'fd00::1'], '127.0.0.1.nip.io': ['127.0.0.1'] })
  assert.deepEqual(await resolvePublic('ok.example', { lookup }), ['185.199.108.153', '2606:50c0:8000::153'])
  await assert.rejects(resolvePublic('mixed.example', { lookup }), { code: 'EBLOCKED' })
  await assert.rejects(resolvePublic('v6.example', { lookup }), { code: 'EBLOCKED' })
  await assert.rejects(resolvePublic('127.0.0.1.nip.io', { lookup }), { code: 'EBLOCKED' })
  await assert.rejects(resolvePublic('missing.example', { lookup }), { code: 'ENOTFOUND' })
})

test('validatePublicUrl: syntax + DNS', async () => {
  const lookup = fakeLookup({ 'evil.example': ['169.254.169.254'], 'good.example': ['93.184.216.34'] })
  assert.equal((await validatePublicUrl('http://evil.example/', { lookup })).code, 'refused')
  assert.equal((await validatePublicUrl('https://good.example/', { lookup })).ok, true)
  assert.equal((await validatePublicUrl('https://nope.example/', { lookup })).code, 'unresolved')
})

test('publicLookup works as an http lookup and refuses private', async () => {
  const r = await new Promise((done) => publicLookup('127.0.0.1', {}, (e, a) => done({ e, a })))
  assert.equal(r.e.code, 'EBLOCKED')
})

test('followRedirects re-validates each hop and caps at 3', async () => {
  // A local server stands in for the public web: our lookup maps the fake public names to 127.0.0.1 only at connect
  // time (lookupFn), while validation sees public addresses, so the redirect logic itself is under test.
  let hits = 0
  const srv = createServer((req, res) => {
    hits++
    const m = req.url.match(/^\/hop\/(\d+)$/)
    if (req.url === '/to-private') { res.writeHead(302, { location: 'http://10.0.0.1/' }); return res.end() }
    if (req.url === '/to-metadata') { res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end() }
    if (m && Number(m[1]) > 0) { res.writeHead(302, { location: `/hop/${Number(m[1]) - 1}` }); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>hi</p>')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const port = srv.address().port
  const lookup = fakeLookup({ 'pub.example': ['93.184.216.34'] })
  const lookupFn = (h, o, cb) => { if (typeof o === 'function') cb = o; cb(null, '127.0.0.1', 4) }
  // The test server is on a high port; checkUrl only allows 80/443, so rewrite the port at request time.
  const http = await import('node:http')
  const request = (u, opts) => http.request({ ...opts, host: '127.0.0.1', port, path: u.pathname, lookup: lookupFn })
  try {
    const ok = await followRedirects('http://pub.example/hop/3', { lookup, request })
    assert.equal(ok.ok, true)
    assert.equal(ok.hops.length, 4)
    const tooMany = await followRedirects('http://pub.example/hop/4', { lookup, request })
    assert.equal(tooMany.code, 'redirects')
    const priv = await followRedirects('http://pub.example/to-private', { lookup, request })
    assert.equal(priv.code, 'refused')
    assert.match(priv.reason, /redirects/)
    const meta = await followRedirects('http://pub.example/to-metadata', { lookup, request })
    assert.equal(meta.code, 'refused')
    const before = hits
    assert.equal((await followRedirects('http://127.0.0.1/', { lookup, request })).code, 'refused')
    assert.equal(hits, before, 'a refused URL is never fetched')
  } finally { srv.close() }
})
