# 12. MCP server for coding agents

`uiscout mcp` serves a project to a coding agent (Claude Code, Cursor, Copilot, any MCP client) over stdio. The server has **no model and needs no API key**: your agent brings its own. It can read the graph, the findings and the intent coverage, walk a single control in a real browser, and **propose** edges and rules.

Proposals are quarantined. They change nothing (no test, no coverage, no baseline) until the runner proves them, so a wrong guess costs one browser run and nothing else.

## Connect an agent

Run it from the app's package (the config is found upwards, as for `check`), or point it there with `--dir`. Tools that click need the app running: the MCP server doesn't start `webServer`.

**Claude Code**

```sh
cd ~/dev/my-app
claude mcp add uiscout -- pnpm exec uiscout mcp           # uiscout installed in the app
# or, with a checkout next to the app:
claude mcp add uiscout -- node ~/dev/uiscout/src/cli.ts mcp --dir ~/dev/my-app
```

**Cursor, Copilot and other clients** (`.cursor/mcp.json`, `.vscode/mcp.json` or the client's equivalent):

```json
{
  "mcpServers": {
    "uiscout": { "command": "npx", "args": ["uiscout", "mcp"] }
  }
}
```

The server reads files on every call, so a new `uiscout check` is picked up without restarting it. Run at least one `uiscout check` (or `check --update`) first. Tools that open a browser go only to the `url` in `uiscout.config.json`; an agent can't choose the URL.

## Tools

### Reading

| Tool | Returns |
| --- | --- |
| `get_graph` | Every screen with actions out, actions in place and finding count. Start here |
| `get_node` | One screen: how to reach it, every action from it (destination, API calls, delayed, safety), the ways in, its findings and its controls |
| `plan_path` | The shortest observed sequence of actions to a screen (from the entry, or from `from`) |
| `get_failures` | Findings from the last run, one entry per message with every place it happened (filter by `severity`) |
| `get_uncovered` | Controls the run saw but didn't act on, grouped by reason: candidates for proposals, replay or more budget |
| `get_intent` | Intent lines and their state: linked, failing, pending, stale, unchecked |

The read tools take an optional `source`: `run` (the last run in `.uiscout/`, the default when present) or `baseline` (the committed `uiscout/`).

### Acting

| Tool | Does |
| --- | --- |
| `run_edge` | Replays the path to a screen in a real browser, acts on one control (by element ID, `data-testid` or exact visible name), and reports where it led, the API calls and any findings. Destructive controls are skipped unless the project uses replay mode |
| `propose_edge` | Records a hypothesis: a control on a screen leads somewhere (`expectTo`). Status `proposed` |
| `verify_proposal` | Walks a proposed edge. `verified` only if the runner observes the transition (to `expectTo` when given); otherwise `refuted`, with the evidence |
| `propose_rule` | Records a draft rule (TypeScript for `uiscout/rules`) for an intent line. Never activated by the server: a developer adds it to a `*.rules.ts` file in a pull request |
| `list_proposals` | Every proposal and its status |

## The proposal lifecycle

```
propose_edge ──► proposed ──verify_proposal──► verified  (the runner saw it)
                                     └───────► refuted   (it saw something else; evidence kept)

propose_rule ──► proposed ──► a developer copies it into *.rules.ts in a PR ──► a rule
```

Proposals live in `uiscout/proposals.json`, next to the baseline. Verified edges don't enter the graph by themselves: the next `uiscout check --update` records what the runner observes, as for any edge.

## What to ask your agent

- "Using uiscout, list the errors from the last run and fix the one on /checkout."
- "Which screens can't be reached from the entry? Plan a path to /settings."
- "Read the intent coverage. For each pending line, propose a rule."
- "get_uncovered shows controls skipped as `input`. Propose edges for the ones that should navigate, then verify them."
- "Before I merge, walk the 'Export' button on /docs and tell me what it calls."

## Safety

- `run_edge` and `verify_proposal` click in a real browser, only against the app at the `url` in `uiscout.config.json` (never a URL from the agent: sign-in and setup steps type credentials into the page). A context with `auth` is signed in the same way `check` does it, before the walk, with the same safety rules as `check`: destructive controls are skipped in live mode, `block` applies, and replay mode serves recorded responses only.
- The server never edits the app's code, its rules, or the baseline graph.
- Review `uiscout/proposals.json` like any other file before committing it.

Next: [Safety and sensitive data](13-safety.md).
