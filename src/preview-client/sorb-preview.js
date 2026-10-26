// No-build Sorb live preview for plain HTML pages (the React path is @sorb/leaf's SorbProvider).
// Add to the page after tokens.css:
//   <script src="sorb-preview.js" data-bridge="http://localhost:7777"></script>
// then open the page with ?preview=<id> (from `s2t preview`). Polls the bridge like @sorb/leaf does
// (1.5 s) and writes each token as a custom property on :root. Keys are CSS var names without "--".
;(function () {
  var script = document.currentScript
  var bridge = ((script && script.getAttribute('data-bridge')) || 'http://localhost:7777').replace(/\/$/, '')
  var id = new URLSearchParams(location.search).get('preview')
  if (!id) return
  // Same fail-safe idea as @sorb/leaf sanitize: skip anything that could break out of a declaration.
  var unsafe = /[;{}<>\\]|url\(|expression\(|@import|javascript:/i
  var applied = ''
  function apply(tokens) {
    var key = JSON.stringify(tokens)
    if (key === applied) return
    applied = key
    Object.keys(tokens).forEach(function (k) {
      var v = String(tokens[k])
      if (!/^[a-z0-9-]+$/i.test(k) || unsafe.test(v)) return
      document.documentElement.style.setProperty('--' + k, v)
    })
    var badge = document.getElementById('sorb-preview-badge')
    if (!badge) {
      badge = document.createElement('div')
      badge.id = 'sorb-preview-badge'
      badge.setAttribute('role', 'status')
      badge.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 12px;border-radius:999px;background:#111;color:#fff;font:600 13px/1 system-ui,sans-serif'
      document.body.appendChild(badge)
    }
    badge.textContent = 'Sorb preview · ' + Object.keys(tokens).length + ' token' + (Object.keys(tokens).length === 1 ? '' : 's')
  }
  function poll() {
    fetch(bridge + '/preview/' + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : null })
      // Published @sorb/juice 0.3.0 returns the bare token map; newer source wraps it as {id, tokens}.
      .then(function (j) { if (j && typeof j === 'object') apply(j.tokens && typeof j.tokens === 'object' ? j.tokens : j) })
      .catch(function (e) { void e })
  }
  poll()
  setInterval(poll, 1500)
})()
