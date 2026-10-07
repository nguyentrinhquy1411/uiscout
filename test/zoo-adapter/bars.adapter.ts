import type { Page } from 'playwright'
import type { WidgetAdapter } from '../../src/adapter.ts'

interface Task { id: string; start: number; end: number; row: number }
interface State { tasks: Task[]; boxes: Record<string, { left: number; width: number }> }

const read = async (page: Page): Promise<State> => {
  const tasks = await page.evaluate(() => (window as unknown as { __flowcheck: { bars: { getState(): Task[] } } }).__flowcheck.bars.getState())
  const boxes = await page.evaluate(() => {
    const track = document.getElementById('track')!.getBoundingClientRect()
    return Object.fromEntries([...document.querySelectorAll<HTMLElement>('.bar')].map((el) => {
      const r = el.getBoundingClientRect()
      return [el.dataset.id!, { left: r.left - track.left, width: r.width }]
    }))
  })
  return { tasks, boxes }
}

const adapter: WidgetAdapter<State, { move: { id: string; minutes: number } }> = {
  id: 'zoo.Bars',
  harness: '/bars.html',
  read,
  actions: {
    async move(page, { id, minutes }) {
      const box = (await page.locator(`.bar[data-id="${id}"]`).boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + minutes / 2, y, { steps: 3 })
      await page.mouse.move(x + minutes, y, { steps: 3 })
      await page.mouse.up()
    },
  },
  generate: (state, random) =>
    state.tasks.map((t) => ({ action: 'move', args: { id: t.id, minutes: (Math.floor(random() * 9) - 4) * 30 } })),
  invariants: [
    (_, next) => next.tasks.every((t) => t.end > t.start) || 'a task ends before it starts',
    (prev, next, step) => {
      const moved = (step.args as { id: string }).id
      for (const t of next.tasks) {
        const before = prev.tasks.find((p) => p.id === t.id)!
        if (t.end - t.start !== before.end - before.start) return `moving ${moved} changed the duration of ${t.id}: ${before.end - before.start} → ${t.end - t.start} min`
      }
      return true
    },
    (_, next) => {
      for (const t of next.tasks) {
        const box = next.boxes[t.id]
        if (Math.abs(box.left - t.start) > 1) return `${t.id} is drawn at ${box.left}px for start ${t.start}`
      }
      return true
    },
  ],
}

export default adapter
