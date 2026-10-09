# Roadmap

What got in the way when uiscout was added to a real app (a pnpm monorepo with a Vite
web app, a session-cookie API and sign-in), and what removed each obstacle.

## Shipped

| # | Change | Where |
| --- | --- | --- |
| 1 | **`uiscout init`**: framework, package manager, dev command and port; a config with `webServer`, `seeds: ["auto"]` and `block` for AI, payment and analytics hosts found in the code; `.gitignore`; `scout*` scripts | [Install](01-install.md#set-up-an-app-uiscout-init) |
| 2 | **`webServer`**: uiscout starts the app, waits, and stops it however the run ends | [Configuration](03-config.md#starting-the-app-webserver) |
| 3 | **Sign in once (`auth`)**: run in a fresh browser, saved state where every screen starts; `${VAR}` for secrets | [Configuration](03-config.md#sign-in-auth) |
| 5 | **`--quick`** and live progress with a time-left estimate | [The check command](02-check.md) |
| 6 | **Monorepos**: the config is found upwards; `root` for rules and adapters | [Configuration](03-config.md) |
| 7 | **`check --watch`**: reruns on save, affected screens only with a baseline | [The check command](02-check.md#while-coding---watch) |
| 8 | **`uiscout export`**: a finding as a Playwright test | [The check command](02-check.md#from-a-finding-to-a-test-uiscout-export) |
| 9 | **Report by screen**: screens with errors first, numbered errors, a repro line and the control's source file and line | [The check command](02-check.md#reading-the-report) |
| 10 | **Identity plugins for webpack and Next.js** (webpack and Turbopack) | [Plugins](10-plugin-affected.md) |
| 11 | **Field-aware typing**: type, hints, `pattern`, `min`/`max`, `maxlength` | [Configuration](03-config.md#what-gets-typed) |
| 12 | **Seeds from the router**: TanStack Router, Next.js app and pages routers | [Configuration](03-config.md#seed-routes) |
| 13 | **A hosted report per pull request**: `uiscout site` and a Vercel workflow | [CI](11-ci.md#a-hosted-report-per-pull-request) |

## Next

| # | Change | Why |
| --- | --- | --- |
| 4 | **Published on npm**, with the CLI built for Node 20+ (today the sources need Node 24 and a git checkout) | `npx uiscout init` without cloning |
| 14 | React Router and Vue Router route discovery | `seeds: ["auto"]` beyond TanStack and Next.js |
| 15 | Comboboxes and sliders operated, not only recorded | Forms with selects get walked |
