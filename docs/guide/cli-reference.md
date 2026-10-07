# CLI reference

```text
uiscout check    [--url <url>] [options]
uiscout graph    [<graph.json>] [--open] [--out <dir>]
uiscout diff     <before.graph.json> <after.graph.json>
uiscout fuzz     [--url <url>] [--seed <n>] [--runs <n>] [--length <n>]
uiscout adapters [--url <url>] [--dir <dir>] [--seed <n>] [--runs <n>] [--length <n>]
uiscout --help
```

Every command reads `./uiscout.config.json` when it exists; flags override it.

## `uiscout check`

Walks the app, runs every oracle, compares with the baseline when there is one, writes the results.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config <file>` | `./uiscout.config.json` if present | Settings file |
| `--url <url>` | from config | Entry URL of the running app |
| `--out <dir>` | `.uiscout` | Output directory |
| `--depth <n>` | 2 | Actions from the entry |
| `--max-steps <n>` | 250 | Total actions |
| `--seeds <paths>` | — | Comma-separated routes no link reaches |
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
| `uiscout/vite` | The `uiscoutIds()` plugin |
