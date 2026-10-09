(() => {
  if (!document.getElementById('edges')) return
  // ---- The walked map: an example shop, and the kind of defect a first walk turns up.
  const NODES = [
    { id: 'root', label: '/', x: 20, y: 140, w: 110 },
    { id: 'prod', label: '/products', x: 200, y: 40, w: 150 },
    { id: 'price', label: '/pricing', x: 200, y: 105, w: 150 },
    { id: 'acct', label: '/account', x: 200, y: 170, w: 150 },
    { id: 'search', label: '/ [Search]', x: 200, y: 235, w: 150, overlay: true },
    { id: 'item', label: '/products/:id', x: 390, y: 40, w: 160 },
    { id: 'cart', label: '/checkout', x: 390, y: 105, w: 160 },
    { id: 'confirm', label: '/checkout [Confirm]', x: 390, y: 170, w: 160, overlay: true },
  ]
  const H = 32
  const WALK = [
    ['root', 'prod', 'click Products', 'ok'],
    ['prod', 'item', 'click Desk lamp', 'ok'],
    ['root', 'price', 'click Pricing', 'ok'],
    ['price', 'cart', 'click Buy now', 'ok'],
    ['root', 'acct', 'click Account', 'ok'],
    ['root', 'search', 'press /', 'ok'],
    ['cart', 'confirm', 'click Place order', 'network'],
  ]
  const ns = 'http://www.w3.org/2000/svg'
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]))
  const el = (tag, attrs, parent) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e }
  const gEdges = document.getElementById('edges'), gNodes = document.getElementById('nodes')
  const edgeEls = {}, nodeEls = {}
  for (const [a, b] of WALK) {
    const s = byId[a], t = byId[b]
    const x1 = s.x + s.w, y1 = s.y + H / 2, x2 = t.x, y2 = t.y + H / 2, mx = (x1 + x2) / 2
    edgeEls[a + b] = el('path', { class: 'edge', d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` }, gEdges)
  }
  for (const n of NODES) {
    const g = el('g', { class: 'node' + (n.overlay ? ' overlay' : '') }, gNodes)
    el('rect', { x: n.x, y: n.y, width: n.w, height: H, rx: 4 }, g)
    el('text', { x: n.x + 10, y: n.y + 20 }, g).textContent = n.label
    nodeEls[n.id] = g
  }
  const bad = byId.confirm
  const badge = el('g', { class: 'badge' }, gNodes)
  el('circle', { cx: bad.x + bad.w, cy: bad.y, r: 8 }, badge)
  el('text', { x: bad.x + bad.w, y: bad.y + 3.5, 'text-anchor': 'middle' }, badge).textContent = '1'
  nodeEls.confirm.classList.add('err')

  const log = document.getElementById('log'), scout = document.getElementById('scout')
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const line = ([a, b, act, res]) => `${esc(act.padEnd(19))} → ${esc(byId[b].label.padEnd(22))}${res === 'ok' ? '<span class="k">ok</span>' : `<span class="x">${res}</span>`}`
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) return

  // At rest the full map and the error are shown. The walk replays on top of it.
  let i = 0, lines = []
  const step = () => {
    if (i === 0) {
      lines = ['<span class="d">node / (depth 0)</span>']
      Object.values(nodeEls).forEach((g) => g.classList.remove('seen'))
      Object.values(edgeEls).forEach((p) => p.classList.remove('on'))
      badge.style.opacity = 0
      nodeEls.root.classList.add('seen')
    }
    const w = WALK[i], path = edgeEls[w[0] + w[1]], len = path.getTotalLength()
    path.classList.add('on')
    scout.setAttribute('opacity', 1)
    const t0 = performance.now(), dur = 650
    const move = (t) => {
      const k = Math.min(1, (t - t0) / dur), p = path.getPointAtLength(len * (1 - Math.pow(1 - k, 2)))
      scout.setAttribute('cx', p.x); scout.setAttribute('cy', p.y)
      if (k < 1) return requestAnimationFrame(move)
      scout.setAttribute('opacity', 0)
      nodeEls[w[1]].classList.add('seen')
      lines.push(line(w))
      if (w[3] !== 'ok') { badge.style.opacity = 1; lines.push('  <span class="x">POST /api/orders returned 500</span>') }
      log.innerHTML = lines.slice(-5).join('\n')
      i = (i + 1) % WALK.length
      setTimeout(step, i === 0 ? 3200 : 380)
    }
    requestAnimationFrame(move)
  }
  setTimeout(step, 1400)
})()

// ---- Copy buttons
document.querySelectorAll('pre.code').forEach((pre, n) => {
  pre.id = pre.id || 'code-' + n
  const b = document.createElement('button')
  b.className = 'copy'; b.type = 'button'; b.dataset.copy = pre.id; b.textContent = 'copy'
  pre.appendChild(b)
})
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.copy'); if (!b) return
  const src = document.getElementById(b.dataset.copy)
  const text = [...src.childNodes].filter((n) => n !== b).map((n) => n.textContent).join('').trim()
  try { await navigator.clipboard.writeText(text); b.textContent = 'copied' }
  catch { const r = document.createRange(); r.selectNodeContents(src); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'selected' }
  setTimeout(() => (b.textContent = 'copy'), 1400)
})

// ---- Tabs
document.querySelectorAll('[data-tabs]').forEach((box) => {
  const tabs = [...box.querySelectorAll('[role=tab]')]
  const select = (t) => tabs.forEach((x) => {
    const on = x === t
    x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1
    document.getElementById(x.getAttribute('aria-controls')).hidden = !on
  })
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t))
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; select(n); n.focus() }
    })
  })
})
