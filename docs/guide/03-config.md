# 3. Configuration: `uiscout.config.json`

`uiscout init` writes it ([Install](01-install.md#set-up-an-app-uiscout-init)). uiscout finds the nearest `uiscout.config.json` from the current directory up to the repository root, and reads the paths in it from the file's own directory. Command-line flags always **override** the file. Use another file with `--config path/to/file.json`.

Any string may contain `${NAME}`: it's replaced by that environment variable, and a variable that isn't set stops the run (nothing is typed as an empty password).

## Full example

```json
{
  "url": "http://localhost:5173/",
  "webServer": { "command": "pnpm run dev", "timeout": 120 },
  "auth": {
    "steps": [
      { "goto": "/login" },
      { "fill": "Email", "text": "${SCOUT_EMAIL}" },
      { "fill": "Password", "text": "${SCOUT_PASSWORD}" },
      { "click": "Sign in" }
    ],
    "waitFor": "/"
  },
  "depth": 2,
  "maxSteps": 600,
  "concurrency": 4,
  "now": "2026-10-07T09:00:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "seeds": ["auto", "/legacy", "/no-such-page"],
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
| `webServer` | object | — | How to start the app (see below) |
| `auth` | object | — | Sign in once before the walk (see below) |
| `root` | string | the config's directory | Where `*.rules.ts`, `*.intent.md`, `*.adapter.ts` and the router are looked for |
| `depth` | number | 2 | Actions from the entry |
| `maxSteps` | number | 250 | Total actions |
| `concurrency` | number | 4 | Screens explored in parallel |
| `now` | string (ISO) | real time | When the app's clock starts; fix it for repeatable runs |
| `timezone` | string | `Asia/Ho_Chi_Minh` | The browser's time zone |
| `seeds` | string[] | — | Routes no link reaches; `"auto"` reads them from the router (see below) |
| `contexts` | object[] | one `default` context | Personas and their setup (see below). **File only**, no flag |
| `block` | string[] | — | URL globs aborted before they leave the browser |
| `allow4xx` | string[] | — | Expected 4xx: `"404"` or `"GET /api/me"` |
| `allowOverlap` | string | — | CSS selector of elements allowed to overlap |
| `ignoreConsole` | string[] | — | Ignore `console.error` messages containing these |
| `fillText` | string | `uiscout` | What is typed into plain text fields (see "What gets typed") |
| `fastForwardMs` | number | 5000 | Clock fast-forward after each step; 0 turns it off |
| `a11y` | boolean | true | Run the axe checks |
| `network` | string | `live` | `live`, `record` or `replay` ([network](06-network.md)) |
| `baseline` | string | `uiscout` | Baseline directory ([baselines](05-baseline.md)) |

## Starting the app: `webServer`

```json
"webServer": { "command": "pnpm run dev", "url": "http://localhost:5173/", "timeout": 120, "reuseExisting": true }
```

| Key | Default | Meaning |
| --- | --- | --- |
| `command` | — | Shell command, run from the config's directory |
| `url` | the config's `url` | Polled until it answers |
| `timeout` | 60 | Seconds to wait for it |
| `reuseExisting` | true | Use a server already answering at `url` instead of starting one |

The command's output goes to `.uiscout/server.log`. uiscout stops what it started (the whole process group, so the dev server's children too) however the run ends, Ctrl+C included. `check`, `fuzz`, `adapters` and `check --watch` all use it; `--watch` starts it once for every rerun.

## Sign-in: `auth`

```json
"auth": {
  "steps": [
    { "goto": "/login" },
    { "fill": "Email", "text": "${SCOUT_EMAIL}" },
    { "fill": "Password", "text": "${SCOUT_PASSWORD}" },
    { "click": "Sign in" }
  ],
  "waitFor": "/"
}
```

The steps (same kinds as setup steps, below) run **once**, in a fresh browser, before the walk. The cookies and storage they leave are saved, and every screen starts from them. That works for session cookies and tokens in `localStorage`; it's how apps that reload after signing in get walked without signing in again on every screen.

- `waitFor`: after the steps, wait until the URL path is this one or below it (`"/app"` matches `/app/home`; `"/"` matches the root only). When it isn't reached, the run stops and says where the sign-in ended up.
- The saved state lives in a private temporary directory (owner only) and is deleted when uiscout exits: never in `.uiscout/`, which CI uploads.
- A failed step is reported by kind and label (`fill "Password"`), never with what it typed.
- Each context can have its own `auth`; the top-level one applies when there are no `contexts`.
- Use a dedicated test account: everything the walk clicks is done as that user.

## Contexts (personas)

A context has a name, an optional `auth` (above), and setup steps. The setup steps run after **every** page load, so they work for apps that keep the session in memory only; for a session cookie, use `auth`.

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
"seeds": ["auto", "/legacy", "/no-such-page"]
```

`"auto"` stands for every static route the app's router declares:

| Router | Read from | Left out |
| --- | --- | --- |
| TanStack Router | `routeTree.gen.ts` | Routes with parameters (`/docs/$docId`) |
| Next.js app router | `app/**/page.*` (or `src/app`) | `[id]` segments, `_private` folders, `@slots`; `(groups)` are dropped from the path |
| Next.js pages router | `pages/**` (or `src/pages`) | `api/`, `_app`, `_document`, `[id]` pages |

On the command line: `--seeds auto,/legacy`.

They're entered through the history API from the entry (falling back to a page load). A seed that redirects is kept as a `route` edge, e.g. `/legacy → /pricing`, or for a guest `/account → /login`.

## What gets typed

A field gets a value it accepts, so a validated form lets the walk through:

| The field | Gets |
| --- | --- |
| `type="email"`, or a name, autocomplete or label with "email" | `uiscout@example.com` |
| `type="number"` | 42, kept within `min` and `max` |
| `date`, `time`, `datetime-local`, `month`, `week`, `color` | A fixed valid value (`2026-01-15`, `09:30`, …) |
| `tel`, `url`, `password` | `+15555550123`, `https://example.com`, `Uiscout-test-1` |
| Hints: postal code, card number, CVC, expiry, first, last or full name, quantity | `10001`, `4242424242424242`, `123`, `12/30`, `Ada`, `Lovelace`, `Ada Lovelace`, `42` |
| A `pattern` the value doesn't match | The first of a few common shapes that matches (`123456`, `ABC-123`, …) |
| Search boxes, text areas, anything else | `fillText` |

Values are fixed, not random: the same field gets the same text every run, so graphs and snapshots compare. `maxlength` is respected.

Next: [The graph page and snapshots](04-graph.md).
