// No-build Sorb live preview for plain HTML pages (the React path is @sorb/leaf's SorbProvider).
// Add to the page after tokens.css:
//   <script src="sorb-preview.js" data-bridge="http://localhost:7777"></script>
// Two ways to apply a PROPOSED token value (nothing changes without one):
//   ?preview=<id>                         poll a running Sorb bridge (`s2t preview`), like @sorb/leaf does (1.5 s)
//   ?tokens=color-action-primary:e8711a   static proposal in the URL (hosted demos, no bridge needed)
// A banner always says what is proposed (old -> new) and offers "Show original", so a preview is never mistaken
// for the merged result. Keys are CSS custom property names without "--".
;(function () {
  var script = document.currentScript
  var bridge = ((script && script.getAttribute('data-bridge')) || 'http://localhost:7777').replace(/\/$/, '')
  // Hash routers (#/admin) keep the query before or after the hash; read both.
  var params = new URLSearchParams(location.search || (location.hash.split('?')[1] || ''))
  var id = params.get('preview')
  var inline = params.get('tokens')
  if (!id && !inline) return

  // Same fail-safe idea as @sorb/leaf sanitize: skip anything that could break out of a declaration.
  var unsafe = /[;{}<>\\]|url\(|expression\(|@import|javascript:/i
  var applied = {}
  var showingOriginal = false
  var root = document.documentElement

  function originalOf(k) {
    // The committed value, read with any preview override temporarily removed.
    var prev = root.style.getPropertyValue('--' + k)
    root.style.removeProperty('--' + k)
    var v = getComputedStyle(root).getPropertyValue('--' + k).trim()
    if (prev) root.style.setProperty('--' + k, prev)
    return v
  }

  function swatch(c) {
    return '<span style="display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin:0 4px;border:1px solid rgba(255,255,255,.5);background:' + c + '"></span>'
  }

  function render() {
    var bar = document.getElementById('sorb-preview-banner')
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'sorb-preview-banner'
      bar.setAttribute('role', 'status')
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147483647;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:12px;background:#111;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)'
      document.body.appendChild(bar)
    }
    var rows = Object.keys(applied).map(function (k) {
      var a = applied[k]
      return '<code style="font:600 12px ui-monospace,monospace">' + k.replace(/-/g, '.') + '</code>' + swatch(a.from) + a.from + ' &rarr;' + swatch(a.to) + a.to
    }).join('<br>')
    bar.innerHTML = '<div><div style="font-weight:700;margin-bottom:2px">Sorb preview, not merged' + (showingOriginal ? ': showing original' : '') + '</div>' + rows + '</div>'
      + '<button type="button" id="sorb-preview-toggle" style="font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:8px;border:0;cursor:pointer;background:#fff;color:#111">' + (showingOriginal ? 'Show proposal' : 'Show original') + '</button>'
    document.getElementById('sorb-preview-toggle').onclick = function () {
      showingOriginal = !showingOriginal
      Object.keys(applied).forEach(function (k) {
        if (showingOriginal) root.style.removeProperty('--' + k)
        else root.style.setProperty('--' + k, applied[k].to)
      })
      render()
    }
  }

  function apply(tokens) {
    var changed = false
    Object.keys(tokens).forEach(function (k) {
      var v = String(tokens[k])
      if (!/^[a-z0-9-]+$/i.test(k) || unsafe.test(v)) return
      if (applied[k] && applied[k].to === v) return
      var from = applied[k] ? applied[k].from : originalOf(k) || '(unset)'
      applied[k] = { from: from, to: v }
      if (!showingOriginal) root.style.setProperty('--' + k, v)
      changed = true
    })
    if (changed) render()
  }

  if (inline) {
    // "color-action-primary:e8711a,radius-sm:6px" (a bare 3/6/8-digit hex gets its # back).
    var t = {}
    inline.split(',').forEach(function (pair) {
      var i = pair.indexOf(':')
      if (i < 1) return
      var k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim()
      if (/^[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(v)) v = '#' + v
      t[k] = v
    })
    var go = function () { apply(t) }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go)
    else go()
  }

  if (id) {
    var poll = function () {
      fetch(bridge + '/preview/' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null })
        // Published @sorb/juice 0.3.0 returns the bare token map; newer source wraps it as {id, tokens}.
        .then(function (j) { if (j && typeof j === 'object') apply(j.tokens && typeof j.tokens === 'object' ? j.tokens : j) })
        .catch(function (e) { void e })
    }
    poll()
    setInterval(poll, 1500)
  }
})()
