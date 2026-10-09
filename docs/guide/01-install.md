# 1. Install and first run

## Requirements

- **Node 24 or later** (uiscout runs its TypeScript directly with Node during development).
- **pnpm** 10.
- A web app: uiscout starts its dev server (see `init` below), or walks one already running (a dev server, `vite preview`, staging…).

## Install uiscout

```sh
git clone https://github.com/nguyentrinhquy1411/uiscout.git ~/dev/uiscout
cd ~/dev/uiscout
pnpm install                          # installs dependencies and builds dist/
pnpm exec playwright install chromium # the browser that walks the app
pnpm test                             # optional: about 120 tests, ~1 min
```

## Three ways to run it

### A. Call it by path (fastest, no change to the app)

```sh
cd ~/dev/my-app
node ~/dev/uiscout/src/cli.ts check --url http://localhost:5173/
```

An alias saves typing (add it to `~/.zshrc` or `~/.bashrc`):

```sh
alias uiscout="node ~/dev/uiscout/src/cli.ts"
```

The rest of this guide writes `uiscout …`.

### B. Install it in the app as a dev dependency (needed for rules, adapters and the plugin)

Rule files (`*.rules.ts`), adapters (`*.adapter.ts`) and the Vite plugin import `uiscout/rules`, `uiscout/adapter` and `uiscout/vite`. For those imports to resolve, install uiscout in the app:

```sh
cd ~/dev/my-app
pnpm add -D link:../uiscout          # points at the checkout next to it
pnpm exec uiscout check --url http://localhost:5173/
```

With `link:`, run `pnpm build` in the uiscout checkout after changing its code, so `dist/` is current.

### C. Install from GitHub

```sh
pnpm add -D github:nguyentrinhquy1411/uiscout
```

## Set up an app: `uiscout init`

In the app's directory (in a monorepo, the web app's package):

```sh
cd ~/dev/my-app
uiscout init
```

It looks at the project and writes `uiscout.config.json`:

| It reads | It writes |
| --- | --- |
| The framework (Vite, Next.js, Remix, SvelteKit, Astro, Angular, CRA, webpack) and its port, from the dev script (`--port`, `-p`) or `vite.config` | `url` |
| The package manager, from the nearest lockfile up to the repository root, and the `dev` (or `start`) script | `webServer`: uiscout starts the app itself, and stops it afterwards |
| A TanStack Router route tree or a Next.js `app/` or `pages/` directory | `"seeds": ["auto"]`: every static route gets walked, linked or not |
| AI, payment and analytics hosts in the code (OpenAI, Anthropic, Groq, DeepSeek, Gemini, Stripe, Google Analytics, PostHog, Segment, `/api/ai`) | `block`: the walk never sends those requests |

It also adds `.uiscout/` to `.gitignore` and four scripts to `package.json` (`scout`, `scout:quick`, `scout:graph`, `scout:accept`), keeping any that exist. It prints every guess, and never overwrites an existing config without `--force`.

## First run

```sh
pnpm run scout:quick     # uiscout check --quick: a first look in seconds
pnpm run scout           # the full walk
pnpm run scout:graph     # the map of the app, in the browser
```

`--quick` walks one action deep, without the axe checks or the clock fast-forward. While it runs, each screen logs where the walk stands:

```text
  node /docs (depth 0) · 3/10 screens · 12/250 actions · 20s · ~12s left
```

The config is found from any directory below it, up to the repository root, so `uiscout check` works from `src/` too. Paths in it are read from its own directory.

Without `init`, point uiscout at a running app: `uiscout check --url http://localhost:5173/`.

### Behind a sign-in

Add the sign-in once to the config; uiscout runs it in a fresh browser before the walk, and every screen starts signed in:

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

`${NAME}` reads an environment variable, so the password stays out of the file. Details: [Configuration](03-config.md#sign-in-auth).

## What you get

| Output | Where |
| --- | --- |
| Short report | Printed, and saved to `.uiscout/report.txt` |
| Map of the app | `.uiscout/graph.html` (opened by `--open`) |
| Raw data | `.uiscout/graph.json`, `findings.json`, `snapshots.json` |
| A screenshot of each screen | `.uiscout/screens/*.jpg` |
| Pull request comment | `.uiscout/report.md` |

`.uiscout/` is the output of each run, not something to commit (`init` adds it to `.gitignore`).

Next: [The `check` command and its report](02-check.md).
