# 3. Configuration: `uiscout.config.json`

Put the file in the app's root; `uiscout check` reads it automatically. Command-line flags always **override** the file. Use another file with `--config path/to/file.json`.

## Full example

```json
{
  "url": "http://localhost:5173/",
  "depth": 2,
  "maxSteps": 600,
  "concurrency": 4,
  "now": "2026-10-07T09:00:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "seeds": ["/legacy", "/no-such-page", "/account"],
  "contexts": [
    { "name": "guest" },
    { "name": "member", "setup": [
      { "route": "/login" },
      { "fill": "Email", "text": "demo@example.com" },
      { "fill": "Password", "text": "demo-password" },
      { "click": "Log in" }
    ] }
  ],
  "block": ["**/api/ai/**"],
  "allow4xx": ["GET /api/me"],
  "allowOverlap": "[data-event-id]",
  "ignoreConsole": ["Download the React DevTools"],
  "fillText": "uiscout",
  "fastForwardMs": 5000,
  "a11y": true,
  "network": "live",
  "baseline": "uiscout"
}
```

## Keys

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `url` | string | — | The app's entry URL |
| `depth` | number | 2 | Actions from the entry |
| `maxSteps` | number | 250 | Total actions |
| `concurrency` | number | 4 | Screens explored in parallel |
| `now` | string (ISO) | real time | When the app's clock starts; fix it for repeatable runs |
| `timezone` | string | `Asia/Ho_Chi_Minh` | The browser's time zone |
| `seeds` | string[] | — | Routes no link reaches (see below) |
| `contexts` | object[] | one `default` context | Personas and their setup (see below). **File only**, no flag |
| `block` | string[] | — | URL globs aborted before they leave the browser |
| `allow4xx` | string[] | — | Expected 4xx: `"404"` or `"GET /api/me"` |
| `allowOverlap` | string | — | CSS selector of elements allowed to overlap |
| `ignoreConsole` | string[] | — | Ignore `console.error` messages containing these |
| `fillText` | string | `uiscout` | What is typed into text fields |
| `fastForwardMs` | number | 5000 | Clock fast-forward after each step; 0 turns it off |
| `a11y` | boolean | true | Run the axe checks |
| `network` | string | `live` | `live`, `record` or `replay` ([network](06-network.md)) |
| `baseline` | string | `uiscout` | Baseline directory ([baselines](05-baseline.md)) |

## Contexts (personas)

A context has a name and a list of setup steps. The steps run after **every** page load, so they work for apps that keep the session in memory only.

| Step | Example | Does |
| --- | --- | --- |
| `goto` | `{ "goto": "/login" }` | A full page load (in-memory state is lost) |
| `route` | `{ "route": "/login" }` | In-app navigation through the history API, no reload. Prefer it for single-page apps |
| `fill` | `{ "fill": "Email", "text": "a@b.c" }` | Types into the field with that label or placeholder |
| `click` | `{ "click": "Log in" }` | Clicks the button or link with that name; falls back to exact text |
| `press` | `{ "press": "Enter" }` | Presses a key |
| `eval` | `{ "eval": "localStorage.setItem('token','x')" }` | Runs JavaScript in the page |

With two or more contexts:
- the report prefixes locations with `[guest]`, `[member]`;
- the graph records which contexts saw each screen and edge, and the graph page gets a context filter;
- a setup that fails is reported as a `transition` error with the failing step's number, and that context isn't walked in a wrong state.

**Tip:** use dedicated test accounts. The config is plain text.

## Seed routes

Routes no link reaches (the 404 page, an old URL that redirects, a hidden page) that should still be checked:

```json
"seeds": ["/legacy", "/no-such-page", "/account"]
```

They're entered through the history API from the entry (falling back to a page load). A seed that redirects is kept as a `route` edge, e.g. `/legacy → /pricing`, or for a guest `/account → /login`.

Next: [The graph page and snapshots](04-graph.md).
