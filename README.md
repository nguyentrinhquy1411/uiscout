# uiscout

**Graph-driven frontend testing.** Point uiscout at a running web app: it clicks every safe control, types into every field and follows every screen it can reach, then judges every step with deterministic checks. You get a map of the app and a list of real defects. No spec to write, no model, and the same commit gives the same result every time.

```sh
pnpm add -D github:nguyentrinhquy1411/uiscout
pnpm exec playwright install chromium
pnpm exec uiscout check --url http://localhost:5173/ --open
```

```text
uiscout: 1 errors, 2 warnings · 11 nodes, 223 edges, 227 steps

Errors (1)
  script       console.error: Error: Base UI: MenuGroupContext is missing.
               at / → click /.button:account@nav · /calendar → click … · +5 more
```

**Docs:** the [user guide](docs/guide/README.md) and the [CLI reference](docs/guide/cli-reference.md). A landing page with the whole guide lives in [`site/index.html`](site/index.html). The design is in [`docs/design.md`](docs/design.md).

## What it checks

Every step is judged three ways.

| | Asks | Needs |
| --- | --- | --- |
| **Generic oracles** | Is the app broken? Uncaught errors and `console.error`, 5xx and unexpected 4xx, clicks that can't land, overlapping or clipped controls, serious axe rules | Nothing |
| **Rules and intent** | Does it do the right thing? `always`, `when().then()`, `eventually().within()` in `*.rules.ts`, linked to plain sentences in `*.intent.md` | Rules you write ([guide](docs/guide/07-rules-intent.md)) |
| **Baseline** | Is it different from yesterday? A control gone or renamed, an action leading elsewhere, a control moved | One `check --update`, committed ([guide](docs/guide/05-baseline.md)) |

## Features

- **The graph page.** `uiscout check --open` opens a map of every screen in columns by steps from the entry. Overlays are dashed and screens with findings carry a badge. Each screen shows its screenshot with every control outlined, how to reach it, the actions from it and the API calls they made. ([guide](docs/guide/04-graph.md))
- **Personas and hidden routes.** In `uiscout.config.json`, contexts with setup steps (log in as a member) and seed routes that no link reaches. ([guide](docs/guide/03-config.md))
- **Record and replay.**
  - `--mode record` keeps redacted API responses.
  - `--mode replay` answers from them and fails closed, so CI needs no backend and destructive controls can be walked too. ([guide](docs/guide/06-network.md))
- **Affected-only runs.**
  - The `uiscout/vite` plugin stamps each interactive element with a steady ID and its source file.
  - `--affected origin/main` then walks only the screens a change touches. ([guide](docs/guide/10-plugin-affected.md))
- **Pull request comments.** Each run writes `report.md` with the verdict, the graph diff, the errors and coverage. ([guide](docs/guide/11-ci.md), [workflow](examples/github-workflow.yml))
- **Fuzzing.** `uiscout fuzz` takes seeded random walks and shrinks each failure to the shortest sequence that still fails. ([guide](docs/guide/08-fuzz.md))
- **Widget adapters.** Calendars, gantts, boards and canvases are driven by real drags, with invariants checked after each action of a random sequence. ([guide](docs/guide/09-adapters.md), [example](examples/calendar/timegrid.adapter.ts))
- **MCP server.** `uiscout mcp` lets Claude Code, Cursor or Copilot do three things:
  - read the graph and findings;
  - walk one control in a real browser;
  - propose edges and rules, which stay quarantined until the runner proves them.

  It has no model and needs no API key. ([guide](docs/guide/12-mcp.md))
- **Production usage overlay.** `uiscout/track` counts which controls real users act on. Reports then rank untested controls by traffic and list walked controls nobody uses. ([guide](docs/guide/15-usage.md))

## Measured

- **uigraph's navigation gauntlet:** 34 of 35 cases observed, with a five-line config.
  - The case it misses is a link that opens a new tab, which is listed rather than walked.
  - uigraph itself found 0 screens on a TanStack Router app, because it has no adapter for that router. See [comparison](docs/comparison.md).
- **First run on a real calendar app:** found 2 bugs, both since fixed:
  - a menu label rendered outside its group, which threw on every open;
  - chat failing silently when offline.
- **Stable baseline:** the same calendar app at depth 2 (31 screens, 352 edges) reruns with no diff.
- **Affected-only run:** a one-file change walked 5 of 10 screens in 25 s instead of 42 s, and found the same errors.
- **Widget adapter:** a planted drag bug was caught in 3 of 4 seeded runs, each shrunk to a single move.

## Safety

uiscout really clicks:
- Controls named like delete, remove, clear, log out, pay or send are skipped unless the run uses replay.
- Recordings are redacted.
- Screenshots are off in CI.
- Browser tools in the MCP server only go to the configured URL.

Run it against a test environment, never `live` against production. See [safety](docs/guide/13-safety.md).

## Commands

```text
uiscout check    [--url <url>] [options]     walk, judge, compare with the baseline
uiscout graph    [<graph.json>] [--open]     the graph page, without a run
uiscout diff     <before> <after>            compare two graphs
uiscout fuzz     [--seed <n>] [--runs <n>]   seeded random walks
uiscout adapters [--dir <dir>]               run *.adapter.ts
uiscout mcp      [--dir <project>]           MCP server on stdio
uiscout usage    import <files...> | report  production usage overlay
```

| Import | For |
| --- | --- |
| `uiscout/rules` | `always`, `when`, `eventually`, `state` |
| `uiscout/adapter` | the `WidgetAdapter` type |
| `uiscout/vite` | the `uiscoutIds()` plugin |
| `uiscout/track` | `trackUsage()` |

## Developing

Requires Node 24 and pnpm 10.

```sh
pnpm install
pnpm test                 # unit tests and the bug zoo
pnpm scout check --url …  # run the CLI from source
pnpm build                # dist/ for the published package
```

`test/zoo/` holds pages with planted defects and clean pages:
- the defects: an exception, a 500, a broken link, a covered button, overlapping and clipped controls, an unnamed button, a destructive button;
- pages for every way of moving: an unlinked route, a redirect, a timer, a keyboard-only field, guest and member variants, and a toast that must not count as a dialog.

Every oracle must catch its defect and stay silent on the clean pages.
