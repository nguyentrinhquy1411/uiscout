# flowcheck vs uigraph vs wirenav — M0 spike

Oct 6, 2026. Both tools cloned and run on the same apps; numbers below are from those runs, not from their READMEs.

## What each tool is

| | flowcheck (M1) | [uigraph](https://github.com/kanetran29/uigraph) 0.1.3 | [wirenav](https://github.com/rahXephonz/wirenav) |
| --- | --- | --- | --- |
| Platform | Any web app (runtime) | React (react-router v5/v6/data), Vue, Angular, Next | React Native (Expo Router, React Navigation) |
| How the graph is built | Walk the running app in Playwright | Static analysis (ts-morph), then runtime `verify` of candidate edges | Static analysis only |
| Discovers new edges at runtime | Yes (clicks everything safe) | No — `verify` confirms edges static analysis or an agent proposed | No |
| Finds bugs | Yes: script errors, network, dead controls, layout | No oracles: verifies that a transition exists | No: diffs the navigation surface |
| Graph in repo, CI drift check | Not yet (M2) | `uigraph.db` (SQLite), `diff --since-last` | Deterministic `.nav` text file, `check` fails CI on drift |
| Agents | Not yet (M5) | 27-tool MCP server, proposals quarantined until verified | — |
| Status | Prototype | Published CLI, dashboard, gauntlet 35/35 | CLI not shipped yet (v0.1 target) |
| License | TBD | MIT | AGPL-3.0 — read only, never copy |

## Run 1: the calendar app (TanStack Router, IndexedDB, no backend)

| | flowcheck | uigraph | wirenav |
| --- | --- | --- | --- |
| Graph | 42 nodes, 384 edges (depth 2, 2 min) | **0 nodes, 0 edges** — TanStack Router has no adapter | Not applicable (web app) |
| Bugs found | 2 real, both fixed upstream: a Base UI menu label outside its group (threw on every open), chat failing silently offline | — | — |

A static tool is only as good as its router adapter; a runtime walker needs none.

## Run 2: uigraph's own gauntlet sample (react-router data router, 25 patterns, 35 golden cases)

uigraph's `map` scores **35/35** (its own gate: a node, a `must`/`may` edge, or an honest degrade such as an unknown sink). flowcheck, run with no configuration (`--depth 3`, 19 clicks, **7 s**), observed:

| Result | Cases | Why |
| --- | --- | --- |
| ✅ Observed (23) | 8 of 10 route nodes; g04 Link, g05 NavLink, g07 `navigate()`, g08 cross-file alias, g10 state-keyed fan-out, g11 props target, g12a guard → login, g14 effect after login, g17b `location.assign`, g18a plain anchor, g19 async submit, g21 modal confirm, g22 history back, g23 object-form self edge, g24 template prefix | It sees what actually happens, so aliases, props, effects and `location.assign` cost nothing — exactly the cases static analysis can only degrade on |
| ◐ Partial (2) | g09 `navigate(ROUTES.account)` observed as `/pricing → /login` (the guard redirected); g18b external `target=_blank` link listed as skipped | Real behaviour for a guest, not the declared target |
| ❌ Missed (10) | g01g `/legacy`, g01h `*`, g06 redirect route — no link reaches them; g12b, g13, g25 — need the other auth state (one context only); g15 log out, g17a external pay — skipped as destructive; g16 — `setTimeout` 3 s, past the 250 ms settle window; g20 — keyboard Enter, no typing yet | Reachability, contexts, safety, timers, input |

It also reported one network error: `POST /api/checkout returned 404` on "Buy now" — true in that environment (the sample has no backend), so an allow-list entry, not a false positive.

### After M1.5 (contexts, seeds, typing, timers)

With a five-line `flowcheck.config.json` (a guest and a member context, seeds `/legacy`, `/no-such-page`, `/account`), the same run scores **32 of 35**, plus 1 partial, in 37 s:

| Was missed | Now |
| --- | --- |
| g01g `/legacy`, g06 redirect route | seed → `route` edge `/legacy → /pricing` |
| g01h `*` | seed `/no-such-page` → the not-found node |
| g12b, g09 | member context: `/pricing → /checkout`, `/pricing → /account` |
| g13, g25 | guest seed `/account` → `route` edge `/account → /login` |
| g16 timer redirect | fast-forwarded clock: `/checkout → /pricing`, marked `delayed` |
| g20 Enter key | typing: `fill` edge `/ → /products` |

Still missed: g15 log out and g17a external payment (skipped as destructive until replay mode), g18b `target=_blank` (listed as skipped).

## What this decides (M0)

1. **The two approaches miss opposite things.** Static extraction misses nothing it can parse and everything behind an unsupported router; runtime walking misses unlinked routes, other auth states, timers and destructive paths, and nothing else. The design doc's trust tiers (static + observed) are right: neither alone is enough.
2. **Don't rebuild static extraction.** uigraph already does it well for four routers and is MIT. Keep flowcheck's own JSON schema (runtime fingerprints, oracle results and API attribution have no place in uigraph's IR) and add **import of uigraph's graph** as the static tier: its nodes become seed URLs for the walker (fixes g01g, g01h, g06), its `may` edges become a worklist.
3. **What flowcheck must add to close the runtime gaps**, in order of cases fixed:
   - **Contexts** (§5): walk once per persona with a login script → g12b, g13, g25.
   - **Seed routes** from a static graph or the router's route table (TanStack Router's `routeTree.gen.ts` for apps like the calendar) → g01g, g01h, g06.
   - **Keyboard and text input** with a small fixture vocabulary → g20, and every form.
   - **Eventual transitions**: after a step, keep watching the URL for a bounded time (e.g. 5 s) without blocking the walk → g16.
   - **Replay mode** (§6) so destructive edges can be walked safely → g15, g17a.
4. **Where flowcheck is unique**: none of the three tools judges a step. uigraph proves an edge *exists*; flowcheck proves the step *works* (no exception, no failed request, a clickable control, a sane layout). That is the product; the graph is how we get there.
5. **wirenav** shows the CI shape to copy for M2: a line-oriented, byte-deterministic text file whose git diff reads as "edge removed", with declared vs inferred provenance reported separately. Its domain (React Native, static only) doesn't overlap ours.

## How to reproduce

```sh
git clone https://github.com/kanetran29/uigraph && cd uigraph && pnpm install && pnpm build
pnpm --filter @ui-graph/cli run uigraph -- map <copy-of-app> --controls
pnpm exec tsx scripts/gauntlet-report.ts                    # 35/35
(cd examples/sample-gauntlet-react && pnpm exec vite --port 5287)
node src/cli.ts check --url http://127.0.0.1:5287/ --depth 3   # from this repo
```
