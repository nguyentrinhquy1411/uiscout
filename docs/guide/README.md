# uiscout user guide

uiscout walks a running web app the way a curious user would: it clicks every safe control, types into every field and follows every screen it can reach. After **every step** it judges the result with deterministic checks (oracles). You get a map of the app (the graph) and a list of defects, and the same commit gives the same result every time.

The guide follows the order you'll use it in: install, first run, reading the results, then the advanced features.

| # | Page | Read it when |
| --- | --- | --- |
| 1 | [Install and first run](01-install.md) | You're starting out |
| 2 | [The `check` command and its report](02-check.md) | After your first run |
| 3 | [Configuration: `uiscout.config.json`](03-config.md) | You want saved settings, personas or seed routes |
| 4 | [The graph page and snapshots](04-graph.md) | You want to *see* the app and its defects |
| 5 | [Baselines: comparing runs](05-baseline.md) | You want to catch regressions (a control gone, a link that moved) |
| 6 | [Network modes: live, record, replay](06-network.md) | Your app has a backend; you want fast, stable runs that also walk destructive controls |
| 7 | [Business rules and intent files](07-rules-intent.md) | You want to check business rules |
| 8 | [Fuzzing](08-fuzz.md) | You want to find rare action sequences that break things |
| 9 | [Widget adapters](09-adapters.md) | You have drag-and-drop, calendars, gantts or canvas widgets |
| 10 | [Vite plugin and affected-only runs](10-plugin-affected.md) | You want pull requests to run fast |
| 11 | [Running in CI](11-ci.md) | You're adding it to GitHub Actions |
| 12 | [MCP server for coding agents](12-mcp.md) | You want Claude Code, Cursor or Copilot to read the graph and propose tests |
| 13 | [Safety and sensitive data](13-safety.md) | Before running against an app with real data |
| 14 | [Troubleshooting](14-troubleshooting.md) | Results look wrong, noisy, or a command fails |
| — | [CLI reference](cli-reference.md) | You need every command and flag |

## The first five minutes

```sh
# 1. Install uiscout (once)
cd ~/dev/uiscout && pnpm install && pnpm exec playwright install chromium

# 2. Start the app you want to test
cd ~/dev/my-app && pnpm dev            # e.g. on http://localhost:5173

# 3. Walk it and open the map
node ~/dev/uiscout/src/cli.ts check --url http://localhost:5173/ --open
```

The report prints to the terminal, the results go to `.uiscout/`, and the graph page opens in your browser. The command exits with 1 when it found errors.

## Concepts

| Term | Meaning |
| --- | --- |
| **Node (screen)** | A route plus whatever overlay is open: `/calendar`, `/products [Confirm purchase]`. Data IDs in URLs collapse to `:id` |
| **Edge** | An action (click, typing, route) and the screen it leads to |
| **Oracle** | A check that decides whether a step is right |
| **Context** | A persona (guest, member…) with its own setup steps |
| **Baseline** | An accepted run, committed in `uiscout/`, that later runs are compared to |
| **Snapshot** | The controls on a screen (role, name, position), used to spot changes |
| **Finding** | Something a check found: an error, a warning or info |
