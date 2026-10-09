# uiscout user guide

uiscout walks a web app the way a curious user would: it clicks every safe control, types into every field and follows every screen it can reach. After **every step** it judges the result with deterministic checks (oracles). You get a map of the app (the graph) and a list of defects, and the same commit gives the same result every time.

The guide follows the order you'll use it in: install, first run, reading the results, then the advanced features.

| # | Page | Read it when |
| --- | --- | --- |
| 1 | [Install and first run](01-install.md) | You're starting out |
| 2 | [The `check` command and its report](02-check.md) | After your first run |
| 3 | [Configuration: `uiscout.config.json`](03-config.md) | You want to start the app, sign in, add personas or seed routes |
| 4 | [The graph page and snapshots](04-graph.md) | You want to *see* the app and its defects |
| 5 | [Baselines: comparing runs](05-baseline.md) | You want to catch regressions (a control gone, a link that moved) |
| 6 | [Network modes: live, record, replay](06-network.md) | Your app has a backend; you want fast, stable runs that also walk destructive controls |
| 7 | [Business rules and intent files](07-rules-intent.md) | You want to check business rules |
| 8 | [Fuzzing](08-fuzz.md) | You want to find rare action sequences that break things |
| 9 | [Widget adapters](09-adapters.md) | You have drag-and-drop boards, time grids, gantts or canvas widgets |
| 10 | [Identity plugins and affected-only runs](10-plugin-affected.md) | You want source locations in reports and fast pull request runs |
| 11 | [Running in CI](11-ci.md) | You're adding it to GitHub Actions |
| 16 | [Claude Code skill](16-skill.md) | You want Claude Code to run uiscout, read the report and fix what it finds |
| 12 | [MCP server for coding agents](12-mcp.md) | You want Claude Code, Cursor or Copilot to read the graph and propose tests |
| 13 | [Safety and sensitive data](13-safety.md) | Before running against an app with real data |
| 14 | [Troubleshooting](14-troubleshooting.md) | Results look wrong, noisy, or a command fails |
| 15 | [Production usage overlay](15-usage.md) | You want to rank untested controls by real traffic |
| — | [CLI reference](cli-reference.md) | You need every command and flag |

## The first five minutes

```sh
# 1. Install uiscout in the app (once)
cd ~/dev/my-app
pnpm add -D github:nguyentrinhquy1411/uiscout && pnpm exec playwright install chromium

# 2. Write the config: how to start the app, its routes, what to block
pnpm exec uiscout init

# 3. Walk it (uiscout starts the app), then open the map
pnpm run scout:quick
pnpm run scout:graph
```

The report prints to the terminal, the results go to `.uiscout/`, and the graph page opens in your browser. The command exits with 1 when it found errors. Behind a sign-in? Add `auth` to the config ([Configuration](03-config.md#sign-in-auth)).

## Concepts

| Term | Meaning |
| --- | --- |
| **Node (screen)** | A route plus whatever overlay is open: `/dashboard`, `/products [Confirm purchase]`. Data IDs in URLs collapse to `:id` |
| **Edge** | An action (click, typing, route) and the screen it leads to |
| **Oracle** | A check that decides whether a step is right |
| **Context** | A persona (guest, member…) with its own sign-in (`auth`) or setup steps |
| **Repro** | The path that shows a finding, in words, printed under it; `uiscout export` turns it into a Playwright test |
| **Baseline** | An accepted run, committed in `uiscout/`, that later runs are compared to |
| **Snapshot** | The controls on a screen (role, name, position), used to spot changes |
| **Finding** | Something a check found: an error, a warning or info |
