import type { Page } from 'playwright'
import type { AdapterStep, WidgetAdapter } from '../../src/adapter.ts'

/*
 * The calendar app's week time grid as a widget (design doc §8): drag to move,
 * drag an edge to resize, zoom. The app publishes window.__uiscout.calendar
 * (only when the runner is present); boxes are measured in the DOM, so the
 * geometry invariant compares what's stored with what's drawn.
 */

interface CalEvent {
  id: string
  title: string
  day: string
  startMinutes: number
  endMinutes: number
  allDay: boolean
  recurring: boolean
}

interface Box {
  day: string
  top: number
  height: number
  /** Fully inside the scroller's viewport, below the sticky header rows. */
  onScreen: boolean
  /** A press can land on it (not entirely under a stacked event), mid-block and on the bottom edge. */
  grab: boolean
  edge: boolean
}

interface State {
  hourHeight: number
  events: CalEvent[]
  boxes: Record<string, Box>
}

type Actions = {
  move: { id: string; minutes: number }
  resize: { id: string; minutes: number }
  zoom: { dir: 'in' | 'out' }
}

const read = async (page: Page): Promise<State> => {
  const hook = await page.evaluate(() => {
    const cal = (window as unknown as { __uiscout?: { calendar?: { getState(): { hourHeight: number; events: CalEvent[] } } } }).__uiscout?.calendar
    return cal ? cal.getState() : null
  })
  if (!hook) throw new Error('window.__uiscout.calendar is missing: is the app built with the hook?')
  const boxes = await page.evaluate(() => {
    const scroller = document.querySelector('.calendar-scroller')!.getBoundingClientRect()
    const out: Record<string, { day: string; top: number; height: number; onScreen: boolean; grab: boolean; edge: boolean }> = {}
    const reachable = (el: Element, ys: number[], r: DOMRect) =>
      ys.some((y) => [0.5, 0.8, 0.9, 0.3, 0.15].some((fx) => {
        const hit = document.elementFromPoint(r.left + r.width * fx, y)
        return Boolean(hit && el.contains(hit))
      }))
    for (const el of document.querySelectorAll<HTMLElement>('[data-date] [data-event-id]')) {
      const col = el.closest<HTMLElement>('[data-date]')!
      const r = el.getBoundingClientRect()
      const c = col.getBoundingClientRect()
      out[el.dataset.eventId!] = {
        day: col.dataset.date!,
        top: r.top - c.top,
        height: r.height,
        onScreen: r.top > scroller.top + 120 && r.bottom < scroller.bottom - 10 && r.left > scroller.left + 60 && r.right < scroller.right,
        grab: reachable(el, [0.5, 0.35, 0.65].map((f) => r.top + r.height * f), r),
        edge: reachable(el, [r.bottom - 3], r),
      }
    }
    return out
  })
  return { hourHeight: hook.hourHeight, events: hook.events, boxes }
}

/** Drags from a point by dy pixels with several intermediate moves, so native DnD sees dragover. */
async function drag(page: Page, x: number, y: number, dy: number) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + Math.sign(dy) * 6, { steps: 2 })
  await page.mouse.move(x, y + dy / 2, { steps: 4 })
  await page.mouse.move(x, y + dy, { steps: 4 })
  // Resize previews are computed on dragover, frame-throttled: let a frame land before dropping.
  await page.waitForTimeout(60)
  await page.mouse.up()
}

/**
 * A point on the block a press actually lands on. Overlapping events cascade, so
 * the centre of one can belong to the one stacked over it. `edge` asks for the
 * strip just above the bottom (the resize handle) instead of the middle band.
 */
async function grabPoint(page: Page, id: string, edge: 'middle' | 'bottom'): Promise<{ x: number; y: number } | null> {
  return page.evaluate(([id, edge]) => {
    const el = document.querySelector<HTMLElement>(`[data-date] [data-event-id="${id}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const ys = edge === 'bottom' ? [r.bottom - 3] : [0.5, 0.35, 0.65].map((f) => r.top + r.height * f)
    for (const y of ys) {
      for (const fx of [0.5, 0.8, 0.9, 0.3, 0.15]) {
        const x = r.left + r.width * fx
        const hit = document.elementFromPoint(x, y)
        if (hit && el.contains(hit)) return { x, y }
      }
    }
    return null
  }, [id, edge] as const)
}

const adapter: WidgetAdapter<State, Actions> = {
  id: 'calendar.TimeGrid',
  harness: '/calendar?view=week',
  async setup(page) {
    await page.waitForFunction(() => {
      const cal = (window as unknown as { __uiscout?: { calendar?: { getState(): { ready: boolean } } } }).__uiscout?.calendar
      return Boolean(cal?.getState().ready)
    }, null, { timeout: 15_000 })
  },
  read,
  actions: {
    async move(page, { id, minutes }, state) {
      const at = await grabPoint(page, id, 'middle')
      if (!at) throw new Error(`event ${id} has no reachable point to grab`)
      await drag(page, at.x, at.y, (minutes / 60) * state.hourHeight)
    },
    async resize(page, { id, minutes }, state) {
      const at = await grabPoint(page, id, 'bottom')
      if (!at) throw new Error(`event ${id} has no reachable bottom edge`)
      await drag(page, at.x, at.y, (minutes / 60) * state.hourHeight)
    },
    async zoom(page, { dir }) {
      await page.keyboard.press(dir === 'in' ? 'ControlOrMeta+Shift+Period' : 'ControlOrMeta+Shift+Comma')
    },
  },
  generate(state, random) {
    const quarter = (lo: number, hi: number) => (lo + Math.floor(random() * (hi - lo + 1))) * 15
    // Timed, single events drawn tall enough to grab between the resize handles.
    const grabbable = state.events.filter((e) => {
      const b = state.boxes[e.id]
      return !e.allDay && !e.recurring && b?.onScreen && b.height >= 28 && b.grab
    })
    const steps: AdapterStep[] = []
    for (const e of grabbable) {
      let minutes = quarter(-8, 8) || 60
      // Stay inside the day: the grid clamps there, which is a different rule.
      minutes = Math.max(-e.startMinutes, Math.min(minutes, 1440 - e.endMinutes))
      if (minutes) steps.push({ action: 'move', args: { id: e.id, minutes } })
      const grow = quarter(-2, 4) || 30
      if (state.boxes[e.id].edge && e.endMinutes + grow <= 1440) steps.push({ action: 'resize', args: { id: e.id, minutes: grow } })
    }
    steps.push({ action: 'zoom', args: { dir: random() < 0.5 ? 'in' : 'out' } })
    return steps
  },
  invariants: [
    // A task never ends before it starts (§8).
    (_, next) => {
      const bad = next.events.find((e) => !e.allDay && e.endMinutes <= e.startMinutes)
      return bad ? `${bad.title} ends at or before it starts (${bad.startMinutes}–${bad.endMinutes} min)` : true
    },
    // Each block sits where its times say, within 2 px, in the right day.
    (_, next) => {
      for (const e of next.events) {
        const b = next.boxes[e.id]
        if (e.allDay || !b) continue
        if (b.day !== e.day) return `${e.title} is drawn on ${b.day} but starts on ${e.day}`
        const top = (e.startMinutes / 60) * next.hourHeight
        if (Math.abs(b.top - top) > 2) return `${e.title} is drawn at ${b.top.toFixed(1)}px, its start (${e.startMinutes} min) is at ${top.toFixed(1)}px`
        const height = Math.max(((e.endMinutes - e.startMinutes) / 60) * next.hourHeight, 12) - 1
        if (Math.abs(b.height - height) > 2) return `${e.title} is ${b.height.toFixed(1)}px tall, ${e.endMinutes - e.startMinutes} min is ${height.toFixed(1)}px`
      }
      return true
    },
    // Moving keeps the duration and lands on the 15-minute grid; nothing else changes.
    (prev, next, step) => {
      if (step.action !== 'move') return true
      const { id } = step.args as Actions['move']
      const before = prev.events.find((e) => e.id === id)
      const after = next.events.find((e) => e.id === id)
      if (!before || !after) return `${id} disappeared after a move`
      const d0 = before.endMinutes - before.startMinutes
      const d1 = after.endMinutes - after.startMinutes
      if (d0 !== d1) return `moving ${before.title} changed its duration: ${d0} → ${d1} min`
      if (after.startMinutes % 15) return `${before.title} landed off the 15-minute grid at ${after.startMinutes} min`
      return unchangedExcept(prev, next, id)
    },
    // Resizing the end keeps the start; at least 15 minutes remain; nothing else changes.
    (prev, next, step) => {
      if (step.action !== 'resize') return true
      const { id } = step.args as Actions['resize']
      const before = prev.events.find((e) => e.id === id)
      const after = next.events.find((e) => e.id === id)
      if (!before || !after) return `${id} disappeared after a resize`
      if (after.startMinutes !== before.startMinutes || after.day !== before.day) return `resizing the end of ${before.title} moved its start`
      if (after.endMinutes - after.startMinutes < 15) return `${before.title} was resized below 15 minutes`
      return unchangedExcept(prev, next, id)
    },
    // Zooming changes no event data (§8).
    (prev, next, step) => (step.action !== 'zoom' ? true : unchangedExcept(prev, next, null)),
  ],
}

function unchangedExcept(prev: State, next: State, id: string | null): true | string {
  for (const before of prev.events) {
    if (before.id === id) continue
    const after = next.events.find((e) => e.id === before.id)
    if (!after) return `${before.title} disappeared`
    if (after.startMinutes !== before.startMinutes || after.endMinutes !== before.endMinutes || after.day !== before.day) {
      return `${before.title} changed (${before.day} ${before.startMinutes}–${before.endMinutes} → ${after.day} ${after.startMinutes}–${after.endMinutes})${id ? ` while acting on ${id}` : ''}`
    }
  }
  return true
}

export default adapter
