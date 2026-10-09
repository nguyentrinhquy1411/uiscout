# 16. Claude Code skill

The uiscout skill teaches Claude Code the whole loop: install and `init` when the app doesn't have uiscout yet, run `scout:quick`, read the report, open the file each finding points to, fix it, rerun, and write a Playwright test with `export`. It knows the safety rules too: block paid APIs, sign in with a test account through `${VAR}`, never point at production, and never accept a baseline without asking you.

The skill is instructions only: it runs the uiscout CLI in your project and needs no API key of its own. uiscout itself still has to be installable there (Node 24+, see [Install](01-install.md)).

## Install

As a plugin, from inside Claude Code:

```text
/plugin marketplace add nguyentrinhquy1411/uiscout
/plugin install uiscout@uiscout
```

On Claude Code 2.1.275 or later, one line does both:

```text
/plugin install uiscout --marketplace nguyentrinhquy1411/uiscout
```

Or copy the skill by hand, for one project (commit it so your team gets it) or for every project:

```sh
git clone --depth 1 https://github.com/nguyentrinhquy1411/uiscout.git /tmp/uiscout
cp -r /tmp/uiscout/skills/uiscout .claude/skills/          # this project
cp -r /tmp/uiscout/skills/uiscout ~/.claude/skills/        # every project
```

Update with `/plugin update uiscout`, or copy the folder again.

## Use it

Ask in plain words; the skill loads when the request is about UI testing:

- "Find UI bugs in this app and fix them."
- "Set up uiscout here. The app needs a sign-in."
- "Run uiscout on the pages this branch changed."
- "Turn uiscout error 2 into a Playwright test."
- "The uiscout check failed in CI on my PR. What broke?"

Or call it by name: `/uiscout`.

## What it will and won't do

| It will | It asks first |
| --- | --- |
| Run `check`, `check --quick`, `graph`, `export` | Installing uiscout in the app |
| Read `report.md` and `findings.json`, and fix the code | Accepting a baseline (`check --update`) |
| Add missing paid or side-effecting APIs to `block` | Creating a test account |
| Rerun until the error is gone | Anything against a non-local URL |

## With the MCP server

The skill drives the CLI. For an agent that also clicks single controls and proposes edges and rules, add the [MCP server](12-mcp.md) as well; the two work together.

Next: [MCP server for coding agents](12-mcp.md).
