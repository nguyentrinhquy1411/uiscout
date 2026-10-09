---
name: uiscout
description: Find UI bugs in a web app by walking it in a real browser with uiscout, then fix them. Use when the user asks to test the UI, find frontend bugs, check a page or a pull request for regressions, set up uiscout, read a uiscout report, turn a finding into a Playwright test, or accept a new baseline.
---

# uiscout

uiscout opens the running app in Chromium, clicks every control it can reach, fills forms with valid values, and judges every step: uncaught errors, `console.error`, 4xx/5xx responses, accessibility (axe), overlapping or overflowing layout, and the project's own rules. It writes a map of the app (the graph) and a numbered list of findings, each with the clicks that reproduce it and the source file of the control.

Docs: https://uiscout.vercel.app/docs/ · CLI reference: https://uiscout.vercel.app/docs/cli-reference.html

## How to call it

Work from the web app's package (in a monorepo, `apps/web` or similar). Find the command once:

1. `package.json` has `scout` scripts → use them: `pnpm run scout`, `scout:quick`, `scout:graph`, `scout:accept` (or `npm run`, `yarn`, per the lockfile).
2. `uiscout` is a dependency → `pnpm exec uiscout <command>` (or `npm exec`, `yarn`).
3. Neither → it isn't installed. Ask before installing; then:
   ```sh
   pnpm add -D github:nguyentrinhquy1411/uiscout
   pnpm exec playwright install chromium
   pnpm exec uiscout init
   ```
   uiscout needs Node 24+. It is not on npm: never run `npx uiscout`, which would fetch an unrelated package of that name if one exists.

## Set up (`uiscout init`)

`init` writes `uiscout.config.json` (url, `webServer` to start the dev server, `seeds: ["auto"]` from the router, `block` for AI, payment and analytics hosts it found in the code), adds `.uiscout/` to `.gitignore` and the `scout*` scripts. Show the user what it guessed. Then check:

- **`block`**: every paid or side-effecting API (AI, payments, email, SMS) must be blocked, or the walk will call it. Add globs such as `"**/api/ai/**"` that `init` missed.
- **Sign-in**: if the app needs an account, add `auth` with a dedicated test account, the password through `${VAR}` (never written into the file):
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
  The walk clicks everything as that user, so it must not be a real person's account. Ask the user for the account; don't create one in a shared or production database without asking.
- **The URL** must be a local or staging app, never production.

## Find bugs

```sh
pnpm run scout:quick      # check --quick: one action deep, seconds
pnpm run scout            # the full walk (depth 2)
```

Exit code: 0 no errors, 1 errors found, 2 usage or setup problem (bad config, sign-in didn't reach `waitFor`, server didn't start: read `.uiscout/server.log`).

Read `.uiscout/report.md` (or `report.txt`). Each error has:
- a number (used by `export`), the oracle (`script`, `network`, `dead-control`, `layout`, `a11y`, `transition`, `structure`, `rule`) and the message;
- `at`: the screen and the control (`/checkout → click checkout.CheckoutForm.placeOrder`);
- `in`: the source file and line of that control, when the identity plugin is installed;
- `repro`: the clicks from the entry.

`.uiscout/findings.json` has the same data for scripts. Warnings (mostly a11y) are worth fixing but don't fail the run.

## Fix a finding

1. Open the file from `in`, or search for the control's name from `at`.
2. A `network` error with a 5xx is often a backend bug: look at the API too. A 4xx the app expects (a 404 page, a guest calling `/api/me`) goes in `allow4xx`, not a code change.
3. Fix the cause, not the symptom: don't silence `console.error` or catch and drop the error.
4. Run `scout:quick` (or `check --watch` while iterating) and confirm the error is gone and no new one appeared.

To keep a fixed bug fixed: `uiscout export <n>` writes `uiscout-<n>.spec.ts`, a Playwright test that walks the repro and fails on the same problem. Run it before the fix (it fails) and after (it passes), then move it into the project's e2e tests if it has them.

## Regressions and pull requests

- `uiscout check --update` (or `scout:accept`) saves the run as the baseline in `uiscout/`, committed with the code. Later runs report screens and controls added, gone or retargeted.
- **Never accept a baseline on your own.** A change in the graph may be the regression the user is looking for. Show the diff and ask; accept only changes the user's own work explains.
- `check --affected origin/main` walks only screens built from changed files (needs the identity plugin: `uiscout/vite`, `uiscout/webpack` or `uiscout/next`).
- `check --mode record` once, then `--mode replay` in CI: recorded responses, no backend needed.
- CI: `examples/github-workflow.yml` in the uiscout repo comments the report on each pull request; `examples/pr-report-vercel.yml` also hosts the graph page per PR (`uiscout site`). Sign-in credentials go in repository secrets.

## Other commands

| Command | Use |
| --- | --- |
| `uiscout graph --open` | The map of the app with findings and screenshots |
| `uiscout fuzz --runs 5` | Random walks with a seed; a failure reruns with the same seed |
| `uiscout adapters` | Scripts for drag, resize and canvas widgets the walk can't operate |
| `uiscout diff a.json b.json` | Compare two graphs |
| `uiscout mcp` | MCP server: graph, findings, `run_edge` to click one control (the app must be running) |

## Safety

- Destructive controls (delete, remove, sign out…) are skipped in live mode; replay mode serves recorded responses only.
- Never paste `.uiscout/server.log`, `auth` values or environment variables into a commit, an issue or a PR comment.
- `.uiscout/` is output: don't commit it. `uiscout/` (the baseline) is committed.
