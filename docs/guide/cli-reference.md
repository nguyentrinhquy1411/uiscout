# CLI reference

```text
uiscout init     [--force]
uiscout check    [--url <url>] [options]
uiscout export   [<n>] [--to <file>]
uiscout site     [--to <dir>] [--screenshots]
uiscout graph    [<graph.json>] [--open] [--out <dir>]
uiscout diff     <before.graph.json> <after.graph.json>
uiscout fuzz     [--url <url>] [--seed <n>] [--runs <n>] [--length <n>]
uiscout adapters [--url <url>] [--dir <dir>] [--seed <n>] [--runs <n>] [--length <n>]
uiscout mcp      [--dir <project>]
uiscout usage    import <file>... [--reset]
uiscout usage    report [<graph.json>]
uiscout --help
```

Every command reads the nearest `uiscout.config.json`, from the current directory up to the repository root; flags override it. Paths in the file are read from its directory; paths given as flags, from the current one.

## `uiscout init`

Writes `uiscout.config.json` for the project in the current directory (framework, port, `webServer`, `seeds`, `block`), adds `.uiscout/` to `.gitignore` and `scout*` scripts to `package.json`. Exits 1 when a config exists, unless `--force`. See [Install](01-install.md#set-up-an-app-uiscout-init).

## `uiscout check`

Walks the app, runs every oracle, compares with the baseline when there is one, writes the results.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | the nearest `uiscout.config.json` | Settings file |
| `--url <url>` | from config | Entry URL (started first when the config has `webServer`) |
| `--quick` | — | Depth 1, no axe, no clock fast-forward (flags given still win) |
| `--watch` | — | Rerun on every saved change, affected screens only when there is a baseline |
| `--out <dir>` | `.uiscout` | Output directory |
| `--depth <n>` | 2 | Actions from the entry |
| `--max-steps <n>` | 250 | Total actions |
| `--seeds <paths>` | — | Comma-separated routes no link reaches; `auto` reads the router |
| `--now <iso>` | real time | When the app's clock starts |
| `--tz <zone>` | `Asia/Ho_Chi_Minh` | Browser time zone |
| `--allow-4xx <list>` | — | Expected 4xx: `404`, `GET /api/me` |
| `--block <globs>` | — | URLs aborted before they leave the browser |
| `--allow-overlap <css>` | — | Elements allowed to overlap |
| `--fast-forward <ms>` | 5000 | Clock fast-forward after each step; 0 = off |
| `--no-a11y` | on | Skip the axe checks |
| `--no-rules` | on | Skip rules and intent coverage |
| `--concurrency <n>` | 4 | Screens explored in parallel |
| `--mode <mode>` | `live` | `live`, `record` or `replay` |
| `--baseline <dir>` | `./uiscout` | Baseline directory |
| `--update` | — | Accept this run as the baseline |
| `--affected <ref>` | — | Walk only screens built from files changed since `<ref>` |
| `--open` | — | Open the graph page when done |
| `--screenshots` | on (off when `CI` is set) | Screenshot every screen |
| `--no-screenshots` | — | No screenshots |
| `--headed` | — | Show the browser |
| `-h`, `--help` | — | Print usage |

Writes to `--out`: `graph.json`, `findings.json`, `snapshots.json`, `report.txt`, `report.md`, `graph.html`, `screens/`. With `--update`: the baseline in `--baseline`. With `--mode record`: `recordings.json` in `--baseline`.

## `uiscout export`

| Argument / flag | Default | Meaning |
| --- | --- | --- |
| (none) | — | Lists the last run's errors, numbered as in the report |
| `<n>` | — | Writes error `n` as a Playwright test |
| `--to <file>` | `./uiscout-<n>.spec.ts` | Where to write it |

Reads `findings.json` and `graph.json` from `--out`. See [The check command](02-check.md#from-a-finding-to-a-test-uiscout-export).

## `uiscout site`

Copies the last run into a directory to host: the graph page as `index.html` (marked `noindex`), `graph.json`, `findings.json`, `report.md`, `report.txt`; `screens/` only with `--screenshots`. Never the server log. `--to` (default `./uiscout-site`) must be new, empty, or written by this command before. See [CI](11-ci.md#a-hosted-report-per-pull-request).

## `uiscout graph`

Writes the graph page from an existing graph, without running the app.

| Argument / flag | Default | Meaning |
| --- | --- | --- |
| `<graph.json>` | `.uiscout/graph.json`, then `uiscout/app.graph.json` | The graph to show |
| `--out <dir>` | `.uiscout` | Where `graph.html` is written |
| `--open` | — | Open it in the browser |

Findings come from a `findings.json` next to the graph; snapshots from `snapshots.json` (a run) or `snapshots/` (a baseline); screenshots from `screens/` next to the graph.

## `uiscout diff`

Compares two graphs: screens and edges added, removed, retargeted. Exits 1 when they differ.

## `uiscout fuzz`

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed <n>` | random | Seed of the first run; run k uses seed + k |
| `--runs <n>` | 5 | Number of walks |
| `--length <n>` | 25 | Actions per walk |
| `--url`, `--block`, `--allow-4xx`, `--mode`, `--baseline`, `--fast-forward`, `--no-rules`, `--out` | as in `check` | |

Writes `fuzz.json` to `--out`.

## `uiscout adapters`

| Flag | Default | Meaning |
| --- | --- | --- |
| `--dir <dir>` | `.` | Where to look for `*.adapter.ts` |
| `--seed <n>` | random | Seed of the first run |
| `--runs <n>` | 5 | Runs per adapter |
| `--length <n>` | 20 | Actions per run |
| `--url`, `--now` | from config | As in `check` |

## `uiscout mcp`

Starts the MCP server on stdio for the project in `--dir` (default: the current directory). Runs until the client disconnects; logs go to stderr. See [MCP server](12-mcp.md).

## `uiscout usage`

| Command | Does |
| --- | --- |
| `usage import <file>... [--reset]` | Adds tracker batches, JSON events or CSV to `uiscout/usage.json` (`--reset` starts over) |
| `usage report [<graph.json>]` | Prints usage-weighted coverage, untested controls by traffic and unused ones, against the last run's graph or the given one |

See [Production usage overlay](15-usage.md).

## Exit codes

| Code | `check` | `diff` | `fuzz` / `adapters` | `graph` |
| --- | --- | --- | --- | --- |
| 0 | No errors | Same | No failures | Page written |
| 1 | Errors | Different | Failures | — |
| 2 | Wrong usage or a crash | same | same | No graph found |

## Imports

| Path | For |
| --- | --- |
| `uiscout/rules` | `always`, `when`, `eventually`, `state` in `*.rules.ts` |
| `uiscout/adapter` | The `WidgetAdapter` type for `*.adapter.ts` |
| `uiscout/vite` | The `uiscoutIds()` plugin (`{ sources: false }` for production) |
| `uiscout/webpack` | The same transform as a webpack loader |
| `uiscout/next` | `withUiscout(config)` for Next.js (webpack and Turbopack) |
| `uiscout/track` | `trackUsage()` for production usage counts |
