/*
 * Usage tracking for production (design doc §10, M6): counts which controls real
 * users act on, by the same IDs the graph uses, so untested edges can be ranked by
 * traffic and unused ones listed.
 *
 *   import { trackUsage } from 'uiscout/track'
 *   trackUsage({ send: (batch) => navigator.sendBeacon('/api/usage', JSON.stringify(batch)) })
 *
 * What is collected, and nothing else: the route with data IDs collapsed to ":id",
 * the control's data-scout-id or data-testid, and the kind of action. No text, no
 * values typed, no user or session identifiers. Controls without an ID are not
 * counted. Counts are aggregated in the page and sent in batches.
 *
 * Plain JavaScript: it is bundled into the app as is.
 */

const DYNAMIC_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26}|(?=.*\d)[\w-]{16,})$/i

/** "/chat/3c94…" → "/chat/:id", matching how the graph names screens. */
export function routeOf(pathname) {
  return pathname.split('/').map((seg) => (DYNAMIC_SEGMENT.test(seg) ? ':id' : seg)).join('/')
}

const ID_SELECTOR = '[data-scout-id],[data-testid]'
const idOf = (el) => el.getAttribute('data-scout-id') || el.getAttribute('data-testid')

/**
 * @typedef {{ route: string, id: string, action: 'click' | 'fill' | 'submit' | 'view', count: number }} UsageEvent
 * @param {{
 *   send: (batch: { events: UsageEvent[] }) => void,
 *   flushMs?: number,
 *   sample?: number,
 * }} options  send: where batches go (sendBeacon, your analytics, …); flushMs: batch
 *   interval (default 10 s, plus on page hide); sample: fraction of page loads that
 *   report (default 1)
 * @returns {() => void} stops tracking and sends what is pending
 */
export function trackUsage(options) {
  if (typeof window === 'undefined') return () => {}
  const sample = options.sample ?? 1
  if (Math.random() >= sample) return () => {}

  /** "route|id|action" → count, so one batch says "Save on /docs: 14" rather than 14 events. */
  const pending = new Map()
  const bump = (route, id, action) => {
    const key = `${route}\u0000${id}\u0000${action}`
    pending.set(key, (pending.get(key) ?? 0) + 1)
  }
  const flush = () => {
    if (!pending.size) return
    const events = [...pending].map(([key, count]) => {
      const [route, id, action] = key.split('\u0000')
      return { route, id, action, count }
    })
    pending.clear()
    try {
      options.send({ events })
    } catch {
      // Tracking must never break the app.
    }
  }

  let lastRoute = ''
  const view = () => {
    const route = routeOf(location.pathname)
    if (route === lastRoute) return
    lastRoute = route
    bump(route, '', 'view')
  }
  const onClick = (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest(ID_SELECTOR) : null
    if (el) bump(routeOf(location.pathname), idOf(el), 'click')
  }
  const onChange = (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest(ID_SELECTOR) : null
    if (el && el.matches('input,textarea,select,[contenteditable]')) bump(routeOf(location.pathname), idOf(el), 'fill')
  }
  const onSubmit = (ev) => {
    const el = ev.target instanceof Element ? ev.target.closest('form[data-scout-id],form[data-testid]') : null
    if (el) bump(routeOf(location.pathname), idOf(el), 'submit')
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  view()
  // Single-page apps change routes without a load: check on history changes.
  const origPush = history.pushState
  const origReplace = history.replaceState
  history.pushState = function (...args) {
    const r = origPush.apply(this, args)
    view()
    return r
  }
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args)
    view()
    return r
  }
  addEventListener('popstate', view)
  document.addEventListener('click', onClick, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('visibilitychange', onHide)
  addEventListener('pagehide', flush)
  const timer = setInterval(flush, options.flushMs ?? 10_000)

  return () => {
    clearInterval(timer)
    history.pushState = origPush
    history.replaceState = origReplace
    removeEventListener('popstate', view)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('change', onChange, true)
    document.removeEventListener('submit', onSubmit, true)
    document.removeEventListener('visibilitychange', onHide)
    removeEventListener('pagehide', flush)
    flush()
  }
}
