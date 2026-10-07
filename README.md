# flowcheck

Graph-driven frontend testing (design: [`docs/design.md`](docs/design.md)). **User guide (Vietnamese): [`docs/guide/`](docs/guide/README.md).** Milestone M1, the zero-spec check: point it at a running app, it clicks every safe control and types into every field on every screen it can reach, once per persona, and judges each step with deterministic oracles. No plugin, no spec, no model.

```sh
pnpm install
pnpm fc check --url http://localhost:5173/ \
  --depth 2 --allow-overlap "[data-event-id]" --block "**/api/ai/**"
```

Writes `.flowcheck/graph.json`, `findings.json`, `report.txt`, `report.md` and `graph.html`; exits 1 when there are errors.

**See the graph:** `flowcheck check --open` opens `graph.html` when the run ends, and `flowcheck graph --open` opens the last run's graph (or `flowcheck graph flowcheck/app.graph.json --open` for the baseline) without running anything. Screens sit in columns by distance from the entry, overlays have a dashed border, screens with findings carry a count badge; click one to see its findings, the path that reaches it, every action from it with the API calls it made, and the ways in. Each screen also shows its **snapshot**: the screenshot taken on arrival with the structural snapshot drawn over it (one box per control, coloured by role; hover for the name), switchable to screenshot or wireframe only, the text form below it, and full size on click. A context filter appears when the graph has more than one. The page is one HTML file plus `screens/*.jpg` next to it, and works offline. Screenshots show whatever the app shows: pass `--no-screenshots` when the run output is shared and the app displays personal data. A baseline keeps only the structure, so `flowcheck graph flowcheck/app.graph.json` shows wireframes.

Settings can live in `flowcheck.config.json` (flags override it). Contexts are configured there only:

```json
{
  "url": "http://127.0.0.1:5287/",
  "depth": 3,
  "seeds": ["/legacy", "/account"],
  "block": ["**/api/ai/**"],
  "contexts": [
    { "name": "guest" },
    { "name": "member", "setup": [{ "route": "/login" }, { "fill": "Name", "text": "ann" }, { "click": "Log in" }] }
  ]
}
```

Setup steps: `goto` (full load), `route` (in-app, through the history API, so in-memory sessions survive), `click` (button or link by accessible name), `fill` (field by label or placeholder), `press`, `eval`. They run after every page load.

## Baselines and CI (M2)

`flowcheck check --update` accepts a run: it writes `flowcheck/app.graph.json` (the graph, a lockfile) and `flowcheck/snapshots/<node>.txt` (one line per control: role, name, landmark, position). Commit both. Every later run is compared to them:

| Change | Severity |
| --- | --- |
| A control is gone, or its role or name changed | Error |
| An action now leads to a different screen | Error (transition) |
| Screens or edges added or removed without updating `flowcheck/` | Error (stale lockfile) |
| A control moved or resized by more than 16 px | Warning |
| A new control | Info |

`flowcheck diff a.json b.json` compares any two graphs. Each run also writes `report.md` for the pull request; see [docs/guide/11-ci.md](docs/guide/11-ci.md) and [examples/github-workflow.yml](examples/github-workflow.yml).

## Identity plugin and affected runs

Without changes to the app, elements are known by fingerprint. Adding the plugin to the app's test build gives every interactive JSX element two attributes:

```ts
// vite.config.ts
import { flowcheckIds } from 'flowcheck/vite'
export default defineConfig(({ mode }) => ({
  plugins: [mode === 'test' && flowcheckIds(), react()],
}))
```

- `data-fc-id="cart.CartSummary.submitOrder"`: `<module>.<Component>.<hint>`, the hint taken from the handler (`navigate('/checkout')` → `navigateCheckout`), the label or the text. Never positional; a `data-testid` wins. It becomes the element's ID in the graph, so relabelling a button doesn't change its identity.
- `data-fc-src="src/features/cart/CartSummary.tsx:48"`: the source witness. Each screen in the baseline lists the files its controls come from.

`flowcheck check --affected origin/main` then walks only the screens built from files changed since that ref, plus the screens one step before them, and judges only that part of the baseline. On the uigraph gauntlet a one-file change walked 5 of 10 screens in 25 s instead of 42 s and found the same errors. It runs everything, and says why, when a changed file isn't tied to any screen (a store, a hook, a config) or the baseline has no source witnesses.

## Rules, intent and fuzzing (M3)

**Rules** (oracle B) live in any `*.rules.ts` file in the project; each exported rule is checked on every path walked:

```ts
import { always, eventually, state, when } from 'flowcheck/rules'

export const emptyCartDisablesOrder = always(
  when(() => state.read('cart.count') === 0).then(() => state.element('cart.order').disabled),
)

export const errorToastClears = always(
  when(() => state.element('cart.toast').visible)
    .then(eventually(() => !state.element('cart.toast').visible).within(5, 'seconds')),
)
```

`state` reads the context, the node (`state.node.is('/checkout')`, or a prefix ending in `*`), any control or `data-testid` element (`visible`, `disabled`, `name`), and values the app exposes in test builds through `window.__flowcheck = { read: () => ({ 'cart.count': n }) }`. Time is the app's clock, fast-forwards included, so `eventually(...).within(5, 'seconds')` works without waiting. A violation is an error that carries the steps from the entry to the state where the rule broke. An `eventually` still open when a path ends before its window has passed is inconclusive, not a failure.

**Intent files** (`*.intent.md`) are plain sentences, each linked to a rule by name:

```md
- An empty cart disables "Place order".   <!-- rule: emptyCartDisablesOrder -->
- Checkout needs a login.                 <!-- rule: pending -->
```

The report shows intent coverage: each line is linked (its rule passed), failing, pending, stale (it names a rule nobody exports, a warning) or unchecked (no path reached it).

**Fuzzing**: `flowcheck fuzz --seed 7 --runs 10 --length 25` takes seeded random walks, checks the rules and the generic oracles after every step, and shrinks each failure to the shortest sequence that still fails. On the zoo a broken toast found after a random walk shrank to the single step "click Save draft". Same seed, same walk.

## Widget adapters (M4)

A complex widget (a calendar grid, a gantt, a canvas editor) is one node with an adapter: semantic actions done with real gestures, state read from a debug hook the app publishes in test builds, and invariants checked after every action of a seeded random sequence. A failing sequence is shrunk to the shortest that still fails.

```ts
// timegrid.adapter.ts
import type { WidgetAdapter } from 'flowcheck/adapter'
export default {
  id: 'calendar.TimeGrid',
  harness: '/calendar?view=week',
  read: (page) => page.evaluate(() => window.__flowcheck.calendar.getState()),
  actions: { move: (page, { id, minutes }) => /* drag the block */ },
  generate: (state, random) => [/* valid next actions */],
  invariants: [(prev, next, step) => /* true or a message */],
} satisfies WidgetAdapter<State, Actions>
```

`flowcheck adapters --url … --seed 11 --runs 6 --length 12` runs every `*.adapter.ts`. The runner creates `window.__flowcheck` before the app loads, so apps publish hooks only when it's there. [`examples/calendar/timegrid.adapter.ts`](examples/calendar/timegrid.adapter.ts) drives the calendar app's week grid (move, resize, zoom) with five invariants: an event never ends before it starts; each block is drawn where its times say, within 2 px, on its day; a move keeps the duration and lands on the 15-minute grid; a resize keeps the start and at least 15 minutes; zoom changes no data. On the real app 72 random actions passed; with a planted bug (a move into the afternoon drops 15 minutes, reachable only by dragging) it failed in 3 of 4 runs, each shrunk to one move.

## Network modes

| `--mode` | Backend | Use |
| --- | --- | --- |
| `live` (default) | Real | First runs, local checks. Destructive controls are skipped |
| `record` | Real | Walks like `live` and keeps every API response in `flowcheck/recordings.json` |
| `replay` | None | Serves API calls (and non-GET form posts) from the recordings. Nothing reaches a server, so destructive controls are walked too. A call with no recording is a warning |

Accept the baseline in the mode CI runs (usually `replay`): replay walks more edges than live.

## What it checks (oracle A)

| Check | Fails when |
| --- | --- |
| Script | Uncaught exception, unhandled rejection, `console.error` during a step |
| Network | A same-origin request returns 5xx, an unexpected 4xx, or fails |
| Dead control | A click can't land (covered, intercepted), or no point of the control is reachable |
| Layout | Two controls overlap by ≥ 25 %, or a control's text is clipped without an ellipsis (warning) |
| Accessibility | An axe rule of serious or critical impact (warning; colour contrast excluded) |
| Transition | A node can't be reached again by replaying its path (warning) |

## How it walks

- **Nodes** are routes (data IDs collapsed to `:id`) plus the overlay on top (`/calendar [Settings]`). An open overlay owns the screen: only its controls are walked.
- **Elements** are known by fingerprint (role, accessible name, test ID, landmark parents, coarse position) and found again by weighted similarity. Inexact matches are listed as healed.
- **Actions:** buttons and links are clicked; text fields get `fillText` (default "flowcheck") and Enter. Steps taken on a screen that stay on it (typed text, a toggle) become part of the path to anything found after them, so every node can be reached again.
- **Contexts:** each persona's setup runs after every page load; nodes and edges record which contexts saw them, so the guest's `/pricing → /login` and the member's `/pricing → /account` are both in the graph.
- **Seeds:** routes no link reaches are entered through the history API from the entry. A seed that redirects is kept as a `route` edge (`/legacy → /pricing`).
- **Timers:** after each step the clock is fast-forwarded (5 s by default), so a redirect three seconds after "Order placed" is recorded as a `delayed` edge without waiting.
- **Safety:** controls named delete / remove / clear / reset / send… are never clicked.
- **Isolation:** each node is explored in a fresh browser context; a reset opens a new one, so state saved by an earlier click (localStorage, IndexedDB) can't leak.
- **Quiescence** instead of timeouts: a step is judged once no request is in flight and the DOM has been still for 250 ms. Animations and transitions are disabled.
- **Flake policy:** a failed click is retried once from a fresh context; a pass there is listed as flaky and never fails the run.
- **Speed:** nodes run 4 at a time; a control on every screen (the app rail) is walked once.

## Using it from another project

```sh
pnpm add -D github:nguyentrinhquy1411/flowcheck   # builds dist/ on install
pnpm exec flowcheck check --url http://localhost:5173/
```

Rule files import `flowcheck/rules`; the Vite plugin is `flowcheck/vite`.

## Tests

```sh
pnpm test     # unit tests + the bug zoo
```

`test/zoo/` holds pages with planted defects (an exception, a 500, `console.error`, a broken link, a covered button, overlapping and clipped controls, an unnamed button, a destructive button) and clean pages, plus pages for each way of moving: a route no link reaches, a redirect, a timer, a keyboard-only field, a page that differs for guests and members, and a toast that must not count as a dialog. Every oracle must catch its defect and report nothing on the clean pages.
