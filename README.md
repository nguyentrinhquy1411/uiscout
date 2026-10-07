# flowcheck

Graph-driven frontend testing (design: [`docs/design.md`](docs/design.md)). Milestone M1, the zero-spec check: point it at a running app, it clicks every safe control and types into every field on every screen it can reach, once per persona, and judges each step with deterministic oracles. No plugin, no spec, no model.

```sh
pnpm install
pnpm fc check --url http://localhost:5173/ \
  --depth 2 --allow-overlap "[data-event-id]" --block "**/api/ai/**"
```

Writes `.flowcheck/graph.json`, `findings.json` and `report.txt`; exits 1 when there are errors.

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

`flowcheck diff a.json b.json` compares any two graphs. Each run also writes `report.md` for the pull request; see [docs/ci.md](docs/ci.md) and [examples/github-workflow.yml](examples/github-workflow.yml).

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

## Tests

```sh
pnpm test     # unit tests + the bug zoo
```

`test/zoo/` holds pages with planted defects (an exception, a 500, `console.error`, a broken link, a covered button, overlapping and clipped controls, an unnamed button, a destructive button) and clean pages, plus pages for each way of moving: a route no link reaches, a redirect, a timer, a keyboard-only field, a page that differs for guests and members, and a toast that must not count as a dialog. Every oracle must catch its defect and report nothing on the clean pages.
