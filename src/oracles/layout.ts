/*
 * Oracle A, layout geometry and dead controls (design doc §7A), judged on the
 * live DOM with no screenshot and no model (the ReDeCheck failure types).
 * Runs inside the page right after collectElements(), which stamped each
 * control with data-scout-i and its visible box (clipped by scrolling ancestors).
 */

export interface LayoutIssue {
  kind: 'overlap' | 'clipped' | 'covered'
  a: number
  b: number
  detail: string
}

/** `allowOverlap`: a selector for controls that overlap by design (stacked calendar events). */
export function checkLayout(allowOverlap: string): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const els = [...document.querySelectorAll<HTMLElement>('[data-scout-box]')]
  const label = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)
  const boxOf = (el: HTMLElement) => {
    const [x, y, w, h] = (el.dataset.scoutBox ?? '0,0,0,0').split(',').map(Number)
    return { left: x, top: y, right: x + w, bottom: y + h, w, h }
  }
  const IGNORE_HIT = '[role=dialog],[role=menu],[role=listbox],[role=tooltip],[data-base-ui-portal],dialog'

  // Covered: no part of the visible box can be clicked — every sample point hits something else.
  for (const el of els) {
    const b = boxOf(el)
    const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([fx, fy]) => [b.left + b.w * fx, b.top + b.h * fy])
    let blocker: Element | null = null
    const reachable = points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit || el.contains(hit) || hit.contains(el) || getComputedStyle(hit).pointerEvents === 'none') return true
      // Something deliberately on top (an open menu or modal) is not a defect of this control.
      if (hit.closest(IGNORE_HIT) && !el.closest(IGNORE_HIT)) return true
      // Scrolled under a sticky header or gutter: the user scrolls it back, nothing is broken.
      for (let p: Element | null = hit; p; p = p.parentElement) if (getComputedStyle(p).position === 'sticky') return true
      blocker = hit
      return false
    })
    if (reachable || !blocker) continue
    const hit = blocker as Element
    issues.push({ kind: 'covered', a: Number(el.dataset.scoutI), b: -1, detail: `"${label(el)}" is covered by <${hit.tagName.toLowerCase()}> "${label(hit)}"` })
  }

  // Overlap: two controls that aren't nested share a real part of their visible area.
  for (let i = 0; i < els.length; i++) {
    const a = boxOf(els[i])
    for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue
      if (allowOverlap && els[i].closest(allowOverlap) && els[j].closest(allowOverlap)) continue
      const b = boxOf(els[j])
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w <= 2 || h <= 2) continue
      if ((w * h) / Math.min(a.w * a.h, b.w * b.h) < 0.25) continue
      issues.push({ kind: 'overlap', a: Number(els[i].dataset.scoutI), b: Number(els[j].dataset.scoutI), detail: `"${label(els[i])}" overlaps "${label(els[j])}"` })
    }
  }

  // Clipped: a control's own text runs past its box with no ellipsis to say so.
  for (const el of els) {
    if (!el.innerText?.trim()) continue
    const style = getComputedStyle(el)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    if (style.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) {
      // A child with its own ellipsis, or a scroll container, is intentional.
      if (/auto|scroll/.test(style.overflowX + style.overflowY)) continue
      if ([...el.querySelectorAll('*')].some((c) => getComputedStyle(c).textOverflow === 'ellipsis')) continue
      issues.push({ kind: 'clipped', a: Number(el.dataset.scoutI), b: -1, detail: `"${label(el)}" text is clipped (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight})` })
    }
  }
  return issues
}
