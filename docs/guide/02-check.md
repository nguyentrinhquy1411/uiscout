# 2. The `check` command and its report

`uiscout check` is the main command: walk the app, judge every step, write the results.

## How it walks

1. Opens the URL in Chromium (1280×800 viewport, `en-US` locale, `Asia/Ho_Chi_Minh` time zone, animations off).
2. On each screen, lists every interactive element a user can see or scroll to (below the fold, in a scrolling panel; not one cut off by a non-scrolling box). While a dialog or menu is open, only the elements inside it. Layout checks judge only what is in view.
3. Acts on each element:
   - buttons, links, tabs, menu items, checkboxes and switches are **clicked**;
   - text fields get a value that fits them (an email, a number in range, a date: see [what gets typed](03-config.md#what-gets-typed)), then **Enter**;
   - comboboxes and sliders are recorded but not operated yet.
4. After each step: waits until no request is in flight and the DOM has been still for 250 ms, fast-forwards the page clock by 5 s, waits again, then runs the oracles.
5. A step that leads to a new screen queues that screen, up to `--depth`.

Every screen is explored in a **fresh browser context** (clean IndexedDB, localStorage and cookies), four screens at a time.

## Common flags

| Flag | Default | Use it to |
| --- | --- | --- |
| `--url <url>` | — | Point at the app (required without a config file) |
| `--quick` | — | A first look: depth 1, no axe, no clock fast-forward |
| `--watch` | — | Run again on every saved change (see below) |
| `--depth <n>` | 2 | Limit actions from the entry. 1 is quick, 2–3 is thorough |
| `--max-steps <n>` | 250 | Cap the total actions; raise it for large apps |
| `--block <globs>` | — | Block paid or noisy APIs: `"**/api/ai/**,**/analytics/**"` |
| `--now <iso>` | real time | Fix the time the app sees, so reruns match |
| `--open` | — | Open the graph page when the run ends |
| `--no-a11y` | on | Skip accessibility checks (faster) |
| `--fast-forward <ms>` | 5000 | Clock fast-forward after each step; `0` turns it off (faster, misses delayed navigation) |
| `--headed` | — | Show the browser window |

Every flag: [CLI reference](cli-reference.md).

## Reading the report

```text
uiscout: 2 errors, 2 warnings · 11 nodes, 223 edges, 227 steps
Screens with errors: /checkout (2)

Graph diff (vs uiscout/app.graph.json)          ← only with a baseline
  (no change)

Errors (2) · uiscout export <n> writes a Playwright test for one
    1  network      POST /api/orders returned 500
                    at /checkout → click checkout.CheckoutForm.placeOrder
                    in src/features/checkout/CheckoutForm.tsx:48
                    repro open / → click "Cart" → click "Checkout" → type "uiscout@example.com" into "Email" → click "Place order"
    2  script       console.error: Error: MenuGroupContext is missing.
                    at /checkout → click checkout.Header.account · /cart → click … · +5 more
                    repro open / → click "Cart" → click "Checkout" → click "Account"

Warnings (2)
  a11y         button-name: Buttons must have discernible text — #nameless
               at load /broken.html

Changes (3)                                      ← info: new controls since the baseline

Intent coverage 2 of 6 lines                     ← only with *.intent.md files

Healed lookups (8): found by similarity, not exact match
Flaky (1): failed, then passed from a fresh context
Never settled (7): DOM kept changing, judged after the timeout
Not walked: 2 destructive, 1 input, 39 repeat
```

### First lines

Errors and warnings are counted **by message**: the same error on seven screens counts once. Then the number of screens, edges and steps walked, and the screens with errors, most first.

While it runs, each screen logs screens done of those found, actions used of the budget, and a rough time left.

### Errors and warnings

Each entry has up to four lines:
- its **number** (errors only, for `uiscout export`), the **oracle** that raised it and its message;
- **at**: where it happened. `load /x` means on arriving at `/x`; `/x → click Y` means after clicking Y on `/x`. With several places, the first three and a count;
- **in**: the source file and line of the control, when the app is built with the [identity plugin](10-plugin-affected.md);
- **repro**: the shortest path that shows it, in words, to follow by hand. For rule violations, **via**: the states that broke the rule.

| Oracle | Raised when | Severity |
| --- | --- | --- |
| `script` | An uncaught exception, or `console.error` | Error |
| `network` | A same-origin request returns 5xx, an unexpected 4xx, or fails | Error |
| `dead-control` | A click can't land (covered, intercepted), or no point of the control is clickable | Error |
| `transition` | An action leads somewhere other than in the baseline; a context's setup failed | Error or warning |
| `structure` | A control gone or renamed (error); moved over 16 px (warning); new (info) | Varies |
| `rule` | A business rule broke | Error |
| `layout` | Two controls overlap by ≥ 25 %; text clipped without an ellipsis | Warning |
| `a11y` | A serious or critical axe rule (colour contrast excluded) | Warning |

### The sections below

| Section | Meaning | Action |
| --- | --- | --- |
| **Healed lookups** | A control was found again by similarity, not an exact match (moved, or slightly renamed) | Usually none. Many of them: consider `data-testid` |
| **Flaky** | A step failed, then passed when retried from a fresh context. Never fails the run | Look if it keeps happening |
| **Never settled** | The DOM never stayed still for 4 s (a ticking clock, an endless animation). The step was still judged | None, unless it comes with errors |
| **Not walked** | Elements not acted on, with the reason | See below |

| "Not walked" reason | Meaning |
| --- | --- |
| `destructive` | The name sounds destructive (delete, remove, clear, send, log out, pay…). Walk them with [replay](06-network.md) |
| `disabled` | The control is disabled |
| `input` | A combobox or slider: not supported yet |
| `new-tab` | The link opens a new tab |
| `external` | The link leaves the site |
| `repeat` | The control is already on the entry screen (the app's nav rail): walked there only |
| `not-found` | The control couldn't be found again after returning to the screen |
| `budget` | `--max-steps` ran out |

## From a finding to a test: `uiscout export`

```sh
uiscout export                       # the errors of the last run, numbered
uiscout export 1 --to e2e/checkout.spec.ts
```

The file is a Playwright test that walks the same path (the sign-in and setup steps from the config included, `${VAR}` kept as `process.env.VAR`) and fails on the same kind of problem: an uncaught exception, `console.error`, or the failing response. For a layout, a11y or rule finding it walks the path and marks where the assertion goes. Run it with `npx playwright test`; once the bug is fixed it stays as a regression test.

## While coding: `--watch`

```sh
uiscout check --quick --watch
```

Runs once, then again every time a file under the project changes (`node_modules`, `.git` and build output ignored). With a [baseline](05-baseline.md) and the [plugin](10-plugin-affected.md), each rerun walks only the screens the changed files build; without one, it reruns everything. The app is started once (`webServer`) and kept for every rerun.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No error-level findings (warnings don't fail a run) |
| 1 | At least one error |
| 2 | Wrong usage, or uiscout itself failed |

## Cutting noise

| Symptom | Fix |
| --- | --- |
| Elements overlap by design (stacked cards, timeline items) | `--allow-overlap "[data-event-id]"` |
| A 4xx is expected (a session check) | `--allow-4xx "GET /api/me"` or `--allow-4xx 404` |
| `console.error` from a third-party library | `"ignoreConsole": ["part of the message"]` in the config |
| An external API is slow or costs money | `--block "**/api/ai/**"` |
| Dates in the UI change the snapshots every day | `--now 2026-10-07T09:00:00+07:00` |

## How long it takes

Roughly 0.4–2 s per step. Screens run in parallel, but the steps on one screen run one after another, so the total is close to the time of the busiest screen. For reference, on a single-page app with 12 routes and sign-in:

| Setting | Time |
| --- | --- |
| `--quick`, `seeds: ["auto"]`, signed in (26 screens, 82 steps) | about 45 s, dev server start included |
| depth 1, defaults | about 110 s |
| depth 1, `--no-a11y --fast-forward 0` | about 70 s |
| depth 2 (31 screens, 431 steps) | about 4 min |

Next: [Configuration](03-config.md).
