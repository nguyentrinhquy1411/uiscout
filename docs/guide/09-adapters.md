# 9. Widget adapters

Calendar grids, gantts, drag-and-drop boards, canvas editors: their actions are drags, resizes and zooms, and right or wrong lives in their data, not in whether a click errors. An **adapter** describes such a widget to uiscout.

> Adapters import types from `uiscout/adapter`: install uiscout in the app (option B in [install](01-install.md)).

## The parts of an adapter

```ts
// src/planning/gantt.adapter.ts
import type { WidgetAdapter } from 'uiscout/adapter'

interface Task { id: string; start: number; end: number }
interface State { tasks: Task[] }
type Actions = { move: { id: string; minutes: number } }

export default {
  id: 'planning.Gantt',
  harness: '/planning',                 // the page that mounts the widget with fixture data

  // 1. Read the state: from a debug hook the app publishes, plus DOM measurements if needed.
  async read(page) {
    const tasks = await page.evaluate(() => window.__uiscout.gantt.getState())
    return { tasks }
  },

  // 2. Act with real mouse and keyboard gestures.
  actions: {
    async move(page, { id, minutes }) {
      const box = (await page.locator(`[data-task="${id}"]`).boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + minutes, box.y + box.height / 2, { steps: 6 })
      await page.mouse.up()
    },
  },

  // 3. The valid next actions; the runner picks one with the seeded generator.
  generate: (state, random) =>
    state.tasks.map((t) => ({ action: 'move', args: { id: t.id, minutes: (Math.floor(random() * 9) - 4) * 30 } })),

  // 4. Invariants after every action: true, or a message describing the violation.
  invariants: [
    (_, next) => next.tasks.every((t) => t.end > t.start) || 'a task ends before it starts',
    (prev, next, step) => {
      const moved = (step.args as Actions['move']).id
      for (const t of next.tasks) {
        const before = prev.tasks.find((p) => p.id === t.id)!
        if (t.end - t.start !== before.end - before.start) return `moving ${moved} changed the duration of ${t.id}`
      }
      return true
    },
  ],
} satisfies WidgetAdapter<State, Actions>
```

| Part | Required | Notes |
| --- | --- | --- |
| `id` | Yes | The widget's name in reports |
| `harness` | Yes | Path of the page with the widget, relative to `--url` |
| `setup(page)` | No | Runs once after the page loads, e.g. to wait for data |
| `read(page)` | Yes | The widget's semantic state |
| `actions` | Yes | Each action takes the page, its arguments and the current state |
| `generate(state, random)` | Yes | The valid actions. Use `random()`, not `Math.random()`, so seeds work |
| `invariants` | Yes | Functions `(prev, next, step) => true \| string` |

## A debug hook in the app

The runner creates `window.__uiscout` **before the app loads**. Publish the hook only when it exists, so production is untouched:

```ts
useEffect(() => {
  const hook = (window as { __uiscout?: Record<string, unknown> }).__uiscout
  if (!hook) return
  hook.gantt = { getState: () => tasksRef.current.map((t) => ({ id: t.id, start: t.start, end: t.end })) }
  return () => { delete hook.gantt }
}, [])
```

A hook is the durable way to read state: no guessing at pixels, and it works for widgets drawn on a canvas.

## Running

```sh
uiscout adapters --url http://localhost:5173/ --seed 11 --runs 6 --length 12
uiscout adapters --url http://localhost:5173/ --dir src/planning   # only look here
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--dir <dir>` | `.` | Where to look for `*.adapter.ts` |
| `--seed`, `--runs`, `--length` | random, 5, 20 | As in fuzzing |
| `--now <iso>` | — | Fix the clock |

```text
uiscout adapters (seed 11)
calendar.TimeGrid: 1 failure
  moving Lunch changed its duration: 60 → 45 min
  seed 12, shrunk from 7 to 1 action:
    1. move {"id":"3","minutes":15}
```

An action that can't be performed (nothing to grab, for instance) is reported as a failure; it doesn't crash the run.

## Tips

- **Press where a press actually lands.** Overlapping elements (cascaded events) can put one element's centre under another. Pick the point with `document.elementFromPoint`.
- **Only generate what's possible.** Filter out elements off screen, covered, or too small to grab.
- **Drag in several moves** (`{ steps: 4 }`) so drag-and-drop libraries see dragover events; wait a frame before dropping.
- **Compare `prev` with `next`**, not only `next`: "everything else stayed the same" catches the most bugs.
- **Run the adapter on a healthy app first.** Several seeds, no violations. If it fails there, the adapter's gesture is usually the problem, not the app.

## Example

[`examples/calendar/timegrid.adapter.ts`](../../examples/calendar/timegrid.adapter.ts) drives a calendar's week grid (move, resize, zoom) with five invariants. The app publishes `window.__uiscout.calendar.getState()`.

Next: [Vite plugin and affected-only runs](10-plugin-affected.md).
