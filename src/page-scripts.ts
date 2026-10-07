import type { RawElement } from './types.ts'

/*
 * Functions that run inside the page through page.evaluate. Each must be
 * self-contained: Playwright sends its source text, so it can't call helpers
 * defined elsewhere in this module.
 */

/** Interactive elements in the viewport, stamped with data-fc-i so a step can click them. */
export function collectElements(): RawElement[] {
  const SELECTOR = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=menuitemcheckbox]',
    '[role=menuitemradio]', '[role=checkbox]', '[role=switch]', '[role=option]', '[role=radio]',
  ].join(',')
  const LANDMARKS: Record<string, string> = { NAV: 'nav', MAIN: 'main', ASIDE: 'aside', HEADER: 'header', FOOTER: 'footer', DIALOG: 'dialog', FORM: 'form' }

  const implicitRole = (el: Element): string => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName
    if (tag === 'A') return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type
      if (type === 'checkbox' || type === 'radio') return type
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
      if (type === 'range') return 'slider'
      return 'textbox'
    }
    return 'generic'
  }

  const nameOf = (el: Element): string => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const label = el.getAttribute('aria-label')
    if (label) return clean(label)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      if (clean(text)) return clean(text)
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null
      const wrapping = el.closest('label')?.textContent
      return clean(forLabel || wrapping || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))
    }
    const text = clean((el as HTMLElement).innerText)
    if (text) return text
    const title = el.getAttribute('title')
    if (title) return clean(title)
    const img = el.querySelector('img[alt], svg[aria-label]')
    return clean(img?.getAttribute('alt') ?? img?.getAttribute('aria-label'))
  }

  const parentsOf = (el: Element): string => {
    const chain: string[] = []
    for (let p = el.parentElement; p && chain.length < 4; p = p.parentElement) {
      const role = p.getAttribute('role')
      if (role && ['navigation', 'main', 'complementary', 'banner', 'dialog', 'alertdialog', 'menu', 'listbox', 'tablist', 'toolbar', 'region'].includes(role)) chain.unshift(role)
      else if (LANDMARKS[p.tagName]) chain.unshift(LANDMARKS[p.tagName])
    }
    return chain.join('>')
  }

  /**
   * The part of an element the user can actually see: its box cut by every
   * scrolling or clipping ancestor and by the viewport. Null when nothing shows.
   */
  const visibleRect = (el: Element): { x: number; y: number; w: number; h: number } | null => {
    const r = el.getBoundingClientRect()
    let left = Math.max(r.left, 0)
    let top = Math.max(r.top, 0)
    let right = Math.min(r.right, innerWidth)
    let bottom = Math.min(r.bottom, innerHeight)
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p)
      if (ps.position === 'fixed') break
      if (ps.overflowX !== 'visible') {
        const pr = p.getBoundingClientRect()
        left = Math.max(left, pr.left)
        right = Math.min(right, pr.right)
      }
      if (ps.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect()
        top = Math.max(top, pr.top)
        bottom = Math.min(bottom, pr.bottom)
      }
    }
    if (right - left < 1 || bottom - top < 1) return null
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) <= 0.05) return null
    return { x: left, y: top, w: right - left, h: bottom - top }
  }

  // An open overlay (modal, menu, popover) owns the screen: only its controls are reachable.
  // A toast is a non-modal alertdialog (often aria-hidden until hovered): it never owns the screen.
  const OVERLAY = ':is([role=dialog],[role=alertdialog],dialog[open],[aria-modal=true],[role=menu],[role=listbox]):not([aria-modal=false],[aria-hidden=true])'
  const overlays = [...document.querySelectorAll(OVERLAY)].filter((o) => visibleRect(o) && !o.parentElement?.closest(OVERLAY))
  const scope: ParentNode = overlays.at(-1) ?? document

  document.querySelectorAll('[data-fc-i]').forEach((el) => {
    el.removeAttribute('data-fc-i')
    el.removeAttribute('data-fc-box')
  })
  const out: RawElement[] = []
  for (const el of scope.querySelectorAll(SELECTOR)) {
    // Hidden from users on purpose: a native input behind a custom checkbox, an inert background.
    if (el.closest('[aria-hidden=true],[inert]')) continue
    const r = visibleRect(el)
    if (!r || r.w <= 2 || r.h <= 2) continue
    // A control nested in another (an icon button inside a link) is one target, not two.
    if (el.parentElement?.closest(SELECTOR) && !el.matches('input,select,textarea')) continue
    const i = out.length
    el.setAttribute('data-fc-i', String(i))
    // The visible part, for the layout checks that run next in the same state.
    el.setAttribute('data-fc-box', `${r.x},${r.y},${r.w},${r.h}`)
    out.push({
      i,
      tag: el.tagName.toLowerCase(),
      role: implicitRole(el),
      name: nameOf(el),
      testId: el.getAttribute('data-testid') ?? el.getAttribute('data-fc-id'),
      source: el.getAttribute('data-fc-src') ?? el.closest('[data-fc-src]')?.getAttribute('data-fc-src') ?? null,
      parents: parentsOf(el),
      href: el.getAttribute('href'),
      target: el.getAttribute('target'),
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
      // Enter in a field presses its form's default button: the runner must judge that button too.
      submit: (() => {
        const form = (el as HTMLInputElement).form
        const button = form?.querySelector('button[type=submit],button:not([type]),input[type=submit]')
        return button ? nameOf(button) || 'submit' : null
      })(),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
    })
  }
  return out
}

/** The accessible name of the topmost open dialog, or '' when none is open. */
export function openDialog(): string {
  const dialogs = [...document.querySelectorAll(':is([role=dialog],[role=alertdialog],dialog[open],[aria-modal=true],[role=menu]):not([aria-modal=false],[aria-hidden=true])')]
    .filter((d) => {
      const r = d.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'
    })
  const top = dialogs.at(-1)
  if (!top) return ''
  const label = top.getAttribute('aria-label')
    ?? (top.getAttribute('aria-labelledby') && document.getElementById(top.getAttribute('aria-labelledby')!)?.textContent)
    ?? top.querySelector('h1,h2,h3,[role=heading]')?.textContent
  return (label || top.getAttribute('role') || 'dialog').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * Installs a mutation counter once per document; quiescence polls it. Runs as an
 * init script, so it is in place before the app's own code.
 */
export function installMutationCounter(): void {
  const w = window as unknown as { __fcMutations?: number }
  if (w.__fcMutations !== undefined) return
  w.__fcMutations = 0
  const start = () => {
    new MutationObserver((records) => { w.__fcMutations! += records.length }).observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true,
    })
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
  // Determinism: no animations or transitions, so a state is final as soon as the DOM is.
  const style = () => {
    const s = document.createElement('style')
    s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
    document.head.appendChild(s)
  }
  if (document.head) style()
  else document.addEventListener('DOMContentLoaded', style, { once: true })
}

export function mutationCount(): number {
  return (window as unknown as { __fcMutations?: number }).__fcMutations ?? 0
}

/**
 * A point inside control `i` that a click would actually land on, relative to
 * its box. Playwright clicks the centre, which can sit under a stacked sibling
 * (cascaded calendar events) while the rest of the control is reachable.
 */
export function hitPoint(i: number): { x: number; y: number } | null {
  const el = document.querySelector(`[data-fc-i="${i}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.5], [0.5, 0.15], [0.85, 0.5], [0.5, 0.85], [0.15, 0.15]]) {
    const x = r.left + r.width * fx
    const y = r.top + r.height * fy
    const hit = document.elementFromPoint(x, y)
    if (hit && (el.contains(hit) || hit.contains(el))) return { x: r.width * fx, y: r.height * fy }
  }
  return null
}
