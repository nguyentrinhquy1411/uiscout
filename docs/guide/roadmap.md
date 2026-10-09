# Roadmap: easier to adopt

What got in the way when uiscout was added to a real app (a pnpm monorepo with a Vite
web app, a session-cookie API and sign-in), and what removes each obstacle. Ordered by
how much friction it removes for a first-time user.

## Now (P0): from zero to a first report in one command

| # | Change | Removes |
| --- | --- | --- |
| 1 | **`npx uiscout init`**: detects the framework (Vite, Next.js, CRA), package manager, dev command and port; writes `uiscout.config.json` with safe defaults; adds `.uiscout/` to `.gitignore` and `scout` / `scout:graph` / `scout:accept` scripts; suggests `block` entries for AI, analytics and payment hosts it finds in the code | Writing a config by hand, guessing flags |
| 2 | **`webServer` in the config** (like Playwright's): `{ "command": "pnpm dev", "url": "http://localhost:5173", "reuseExisting": true }`. uiscout starts the app, waits for it, and stops it afterwards | "Start the app in another terminal first", port mix-ups |
| 3 | **Sign-in that works with cookie sessions**: `auth: { steps: [...] }` runs once in a fresh browser, saves cookies and storage to `.uiscout/auth.json`, and every screen starts from that state. Setup steps today run after every page load, which suits in-memory sessions but loops on apps that reload after signing in | Testing anything behind a login |
| 4 | **Published on npm**, with the CLI built for Node 20+ (today the sources need Node 24 and a git checkout) | Cloning, aliases, `link:` paths |
| 5 | **`--quick`**: depth 1, no axe, no clock fast-forward: about a minute on an 11-screen app. Live progress with screens done / queued and an ETA | Waiting minutes for a first look |

## Next (P1): fit the daily loop

| # | Change | Why |
| --- | --- | --- |
| 6 | **Monorepo awareness**: find the config upwards from the current directory, and a `root` setting so rules and adapters can live in the app package | Running from the wrong folder |
| 7 | **`uiscout check --watch`**: re-walks only the screens a saved file feeds (the plugin's source witnesses) | Feedback while coding, not only in CI |
| 8 | **Export a failing path as a Playwright spec** (`uiscout export --finding 3`) | Hand-off to existing test suites; adoption in teams that already have Playwright |
| 9 | **Report by screen with a one-line repro** ("open /checkout, click Place order") and, with the plugin, the source file and line of the control | Faster triage |

## Later (P2)

| # | Change |
| --- | --- |
| 10 | Identity plugins for Next.js (SWC) and webpack, not only Vite |
| 11 | Smarter input: field types, `pattern` and labels decide what is typed (emails, numbers, dates), so validated forms can be passed |
| 12 | Import a static route graph (uigraph's) as seeds, so routes no link reaches are walked without listing them |
| 13 | A hosted report page per pull request (the graph page, uploaded as a CI artifact today) |
