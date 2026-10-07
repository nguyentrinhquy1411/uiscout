# 15. Production usage overlay

A test map says what uiscout walked. Real traffic says what matters. The usage overlay puts the two together:

- **usage-weighted coverage**: the share of real user actions that land on controls the run walked;
- **untested, by traffic**: the controls people use that tests don't reach, most used first, with the reason;
- **unused**: walked controls nobody used in the period, on screens people do visit.

## 1. Ship IDs to production

Usage is counted by the same IDs the graph uses, so production HTML needs them. Keep the plugin in production builds, without source paths:

```ts
// vite.config.ts
import { uiscoutIds } from 'uiscout/vite'

export default defineConfig(({ mode }) => ({
  plugins: [uiscoutIds({ sources: mode === 'test' }), react()],
}))
```

With `sources: false` only `data-scout-id` is added; no file paths end up in the shipped HTML. Controls with a `data-testid` are counted by it without the plugin.

## 2. Track usage

```ts
// main.tsx
import { trackUsage } from 'uiscout/track'

trackUsage({
  send: (batch) => navigator.sendBeacon('/api/uiscout-usage', JSON.stringify(batch)),
  sample: 0.1,          // 10 % of page loads report; optional
})
```

`send` is yours: post to your own endpoint, or hand the batch to your analytics (PostHog, Segment, GA…) as one custom event. uiscout has no backend and sends nothing anywhere itself.

What is collected, and nothing else:

| Field | Example |
| --- | --- |
| `route` | `/chat/:id` (data IDs collapsed, no query string) |
| `id` | `chat.Composer.send` (the control's `data-scout-id` or `data-testid`) |
| `action` | `click`, `fill` (a field changed; the value is **not** sent), `submit`, `view` (a route was shown) |
| `count` | How many times, aggregated in the page |

No text, no typed values, no user, session or device identifiers. Controls without an ID aren't counted. Batches go out every 10 seconds and when the page is hidden.

## 3. Import the counts

Collect the batches however you like, export them, and import:

```sh
uiscout usage import usage-2026-10.ndjson          # adds to uiscout/usage.json
uiscout usage import week1.csv week2.csv           # several at once
uiscout usage import fresh.json --reset            # start over
```

Accepted formats:

| Format | Shape |
| --- | --- |
| Tracker batches | `{ "events": [ … ] }`, one per line (NDJSON) or in a JSON array |
| JSON events | `[{ "route": "/docs", "id": "docs.Header.export", "action": "click", "count": 3 }]` |
| CSV | A header with `route` (or `path`), `id` (or `element`), and optionally `action`, `count` |

Full URLs are reduced to their path; data IDs in paths collapse to `:id`; `action` defaults to `click` and `count` to 1. Commit `uiscout/usage.json` if you want CI to report against it; it holds only aggregated counts.

## 4. Read the overlay

Once `uiscout/usage.json` exists, every `uiscout check` adds a section:

```text
Usage (uiscout/usage.json: 1,067 actions on tracked controls)
  Usage-weighted coverage 90% (960 of 1,067 actions are on controls the run walked)
  Untested, by traffic
    95  /calendar  calendar.Event.delete  — destructive: walk it with --mode replay
    12  /reports   reports.Page.export    — screen not reached by the walk
  Unused (no use in the period, on screens people visit)
    /settings  settings.Data.importJson  (2,200 views)
```

Without running the app: `uiscout usage report` (against the last run's graph, or `uiscout usage report path/to/graph.json`).

Elsewhere:
- the **pull request comment** shows the coverage and the top untested controls;
- the **graph page** tags each action with its real uses;
- the **MCP server**'s `get_uncovered` returns `untestedByTraffic` and `unused`, so an agent can start with what users touch most.

### Reasons in "untested"

| Reason | What to do |
| --- | --- |
| `destructive: walk it with --mode replay` | Record, then replay ([network](06-network.md)) |
| `out of budget: raise --max-steps` | Raise `maxSteps` |
| `screen not reached by the walk` | Add a seed route, a context, or more depth |
| `never seen on its screen (another state or context?)` | The control only appears in some state: add a context or setup, or propose the edge over MCP |
| `input kind not supported yet` | Comboboxes and sliders aren't operated yet |
| `not found again on its screen` | See [troubleshooting](14-troubleshooting.md) |

### Reading "unused" with care

A control with no use in the period is listed only when its screen had views, so "nobody came here" isn't mistaken for "nobody used this". It may still be rare but important (a yearly export): treat the list as questions for the product team, not as things to delete.

## Notes

- Usage only covers controls with an ID: fingerprint-only controls (no plugin, no `data-testid`) can't be matched to real traffic.
- Sampling scales counts down evenly, so rankings and percentages hold.
- The overlay reads the IDs, not the meaning: a renamed `data-scout-id` starts a new count. Re-import after large refactors.
