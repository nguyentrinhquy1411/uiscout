# 1. Install and first run

## Requirements

- **Node 24 or later** (uiscout runs its TypeScript directly with Node during development).
- **pnpm** 10.
- A web app that is **running** and reachable from a browser (a dev server, `vite preview`, staging…).

## Install uiscout

```sh
git clone https://github.com/nguyentrinhquy1411/uiscout.git ~/dev/uiscout
cd ~/dev/uiscout
pnpm install                          # installs dependencies and builds dist/
pnpm exec playwright install chromium # the browser that walks the app
pnpm test                             # optional: about 70 tests, ~30 s
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

### Scripts in the app (optional)

```json
{
  "scripts": {
    "scout": "uiscout check --open",
    "scout:graph": "uiscout graph --open",
    "scout:accept": "uiscout check --update"
  }
}
```

## First run

1. Start the app: `pnpm dev`.
2. Stay in the **app's root directory**: uiscout reads its config, rules and intent files from the current directory.
3. Run:

```sh
uiscout check --url http://localhost:5173/ --open
```

If the app calls paid APIs (AI, SMS, test payments), block them from the very first run:

```sh
uiscout check --url http://localhost:5173/ --block "**/api/ai/**" --open
```

## What you get

| Output | Where |
| --- | --- |
| Short report | Printed, and saved to `.uiscout/report.txt` |
| Map of the app | `.uiscout/graph.html` (opened by `--open`) |
| Raw data | `.uiscout/graph.json`, `findings.json`, `snapshots.json` |
| A screenshot of each screen | `.uiscout/screens/*.jpg` |
| Pull request comment | `.uiscout/report.md` |

Add `.uiscout/` to the app's `.gitignore`: it's the output of each run, not something to commit.

Next: [The `check` command and its report](02-check.md).
