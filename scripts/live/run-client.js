// Live demo tier C, on the index: "Run it on a public page". Posts the URL to /api/run, polls /api/run/<id> and shows
// the steps (copy → capture → segment → name → rewrite → verify), then links the result page. Copied to site/ by
// scripts/build-site.mjs; the form is only in the page when the server runs tier c.
(() => {
  const form = document.getElementById('run-form')
  if (!form) return
  const input = document.getElementById('run-url')
  const button = form.querySelector('button[type=submit]')
  const budgetEl = document.getElementById('run-budget')
  const status = document.getElementById('run-status')
  const STEP_LABELS = { copy: 'copy the page', capture: 'capture', segment: 'segment', name: 'name', rewrite: 'rewrite', verify: 'verify', focus: 'focus check', report: 'report' }
  const SHOWN = ['copy', 'capture', 'segment', 'name', 'rewrite', 'verify', 'report']
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const tableLink = ' <a href="#breadth-h">See the 28-site table instead</a>.'
  let polling = null

  for (const chip of document.querySelectorAll('[data-run-example]')) {
    chip.addEventListener('click', () => { input.value = chip.getAttribute('data-run-example'); input.focus() })
  }

  function showBudget(b) {
    if (!b) return
    const left = b.budget ? b.budget.left : b.left, total = b.budget ? b.budget.total : b.total
    const runsLeft = b.runsLeft
    let t = `Demo budget: ${Number(left).toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')} left. A run costs 25.`
    if (runsLeft != null) t += runsLeft > 0 ? ` You can start ${runsLeft} more ${runsLeft === 1 ? 'run' : 'runs'} on this visit.` : ''
    // The cap note goes on the budget line, never over a finished run's result link.
    budgetEl.innerHTML = esc(t) + (runsLeft === 0 ? ` <strong>${esc(reasonText(b.reason))}</strong>${tableLink}` : '')
    if (runsLeft === 0) button.disabled = true
  }
  function reasonText(r) {
    return ({ total: 'The demo budget is used up for now.', 'runs-day': 'Today\'s runs are used up.', 'runs-session': 'That\'s the most runs for one visit.', 'runs-ip': 'This network has used today\'s runs.' })[r] || 'No runs left right now.'
  }
  function say(html) { status.innerHTML = html }

  async function refresh() {
    try { const r = await fetch('/api/run', { credentials: 'same-origin' }); if (r.ok) showBudget(await r.json()) } catch (e) { /* offline */ }
  }

  function progress(v) {
    const cur = v.step
    const idx = SHOWN.indexOf(cur === 'focus' ? 'report' : cur)
    const steps = SHOWN.map((s, i) => {
      const state = v.status === 'done' ? 'done' : v.status === 'queued' ? 'todo' : i < idx ? 'done' : i === idx ? 'now' : 'todo'
      return `<li class="step-${state}">${state === 'done' ? '✓ ' : state === 'now' ? '▸ ' : ''}${esc(STEP_LABELS[s])}</li>`
    }).join('')
    const secs = Math.round((v.ms || 0) / 1000)
    const head = v.status === 'queued' ? `Waiting in line: position ${v.position}.` : `Running: ${esc(STEP_LABELS[cur] || cur || '')} (${secs} s).`
    return `<p class="run-msg">${head}</p><ol class="run-steps" aria-label="Steps">${steps}</ol>`
  }

  async function poll(id) {
    clearTimeout(polling)
    let v
    try {
      const r = await fetch(`/api/run/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
      v = await r.json()
      if (!r.ok) { say(`<p class="run-msg">${esc(v.error || 'That run is gone.')}</p>`); forget(); button.disabled = false; return }
    } catch (e) { polling = setTimeout(() => poll(id), 3000); return }
    if (v.status === 'done') {
      const s = (v.result && v.result.summary) || {}
      say(`<p class="run-msg run-done">Done in ${Math.round(v.ms / 1000)} s: ${esc(s.tokens)} tokens proposed, ${esc(s.edits)} values rewritten, fallbacks-only check ${esc(s.fallbackPx)} px.</p><p><a class="try" href="${esc(v.result.page)}">Open the result</a> <span class="muted">Unlisted; deleted after 24 hours.</span></p>`)
      forget(); button.disabled = false; refresh(); return
    }
    if (v.status === 'failed') {
      say(`<p class="run-msg">${esc(v.error)}${v.refunded ? '' : ''}</p>`)
      forget(); button.disabled = false; refresh(); return
    }
    say(progress(v))
    polling = setTimeout(() => poll(id), 1500)
  }

  const KEY = 's2t-run-id'
  const remember = (id) => { try { sessionStorage.setItem(KEY, id) } catch (e) { /* private mode */ } }
  const forget = () => { try { sessionStorage.removeItem(KEY) } catch (e) { /* private mode */ } }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const url = input.value.trim()
    if (!url) { input.focus(); return }
    button.disabled = true
    say('<p class="run-msg">Checking the address…</p>')
    let r, v
    try {
      r = await fetch('/api/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      v = await r.json()
    } catch (e) {
      say(`<p class="run-msg">The demo server did not answer. Try again in a moment.${tableLink}</p>`); button.disabled = false; return
    }
    if (r.status === 202) { remember(v.id); if (v.budget) showBudget(v.budget); say(progress(v)); polling = setTimeout(() => poll(v.id), 1000); return }
    button.disabled = false
    if (r.status === 429) { if (v.budget) showBudget({ ...v.budget, reason: v.reason }); say(`<p class="run-msg">${esc(v.error)}${tableLink}</p>`); return }
    if (r.status === 503) { say(`<p class="run-msg">${esc(v.error || 'Busy, try in a minute.')}${tableLink}</p>`); return }
    say(`<p class="run-msg">${esc(v.error || 'That address can\'t be run.')} You were not charged.</p>`)
  })

  refresh()
  try { const id = sessionStorage.getItem(KEY); if (id) { button.disabled = true; poll(id) } } catch (e) { /* private mode */ }
})()
