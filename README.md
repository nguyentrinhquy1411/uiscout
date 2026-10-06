# flowcheck

Graph-driven frontend testing (design: [`docs/design.md`](docs/design.md)). Milestone M1, the zero-spec check: point it at a running app, it clicks every safe control on every screen it can reach, and judges each step with deterministic oracles. No plugin, no spec, no model.

```sh
pnpm install
pnpm fc check --url http://localhost:5173/ \
  --depth 2 --allow-overlap "[data-event-id]" --block "**/api/ai/**"
```

Writes `.flowcheck/graph.json`, `findings.json` and `report.txt`; exits 1 when there are errors.

## What it checks (oracle A)

| Check | Fails when |
| --- | --- |
| Script | Uncaught exception, unhandled rejection, `console.error` during a step |
| Network | A same-origin request returns 5xx, an unexpected 4xx, or fails |
| Dead control | A click can't land (covered, intercepted), or no point of the control is reachable |
| Layout | Two controls overlap by ≥ 25 %, or a control's text is clipped without an ellipsis (warning) |
| Transition | A node can't be reached again by replaying its path (warning) |

## How it walks

- **Nodes** are routes (data IDs collapsed to `:id`) plus the overlay on top (`/calendar [Settings]`). An open overlay owns the screen: only its controls are walked.
- **Elements** are known by fingerprint (role, accessible name, test ID, landmark parents, coarse position) and found again by weighted similarity. Inexact matches are listed as healed.
- **Safety:** controls named delete / remove / clear / reset / send… are never clicked. Text inputs aren't typed into yet.
- **Isolation:** each node is explored in a fresh browser context; a reset opens a new one, so state saved by an earlier click (localStorage, IndexedDB) can't leak.
- **Quiescence** instead of timeouts: a step is judged once no request is in flight and the DOM has been still for 250 ms. Animations and transitions are disabled.
- **Flake policy:** a failed click is retried once from a fresh context; a pass there is listed as flaky and never fails the run.
- **Speed:** nodes run 4 at a time; a control on every screen (the app rail) is walked once.

## Tests

```sh
pnpm test     # unit tests + the bug zoo
```

`test/zoo/` holds pages with planted defects (an exception, a 500, `console.error`, a broken link, a covered button, overlapping and clipped controls, a destructive button) and a clean page. Every oracle must catch its defect and report nothing on the clean pages.
