# Running flowcheck in CI

The graph and the snapshots are committed like a lockfile (design doc §10). The loop:

1. **Locally**, after a change that alters screens on purpose:
   ```sh
   pnpm exec flowcheck check --update     # writes flowcheck/app.graph.json and flowcheck/snapshots/
   git diff flowcheck/                     # this diff is the review: screens, edges, controls
   git add flowcheck/ && git commit
   ```
2. **On every pull request**, [`examples/github-workflow.yml`](../examples/github-workflow.yml) builds the app, serves it, and runs `flowcheck check`. The run fails when:
   - an oracle finds an error (script error, failed request, dead control),
   - a control in a snapshot is gone or relabelled (oracle C),
   - an action now leads somewhere else (transition),
   - the graph changed and `flowcheck/` wasn't updated in the same PR.
3. **The comment** (`.flowcheck/report.md`) leads with the verdict, the graph changes as a diff and the errors; the full text report is folded underneath. It is updated in place on each push. The same markdown goes to the job summary.

## Making runs repeatable

A baseline only works when two runs of the same commit agree. In practice:

- Fix the time: `"now": "2026-10-07T09:00:00+07:00"` in `flowcheck.config.json`. Dates, "today" and the now-line otherwise change the snapshots daily.
- Seed data the same way every run (fixtures, a seeded test database, or the app's demo data).
- Block anything that costs money or varies (`"block": ["**/api/ai/**"]`).

Measured: the uigraph gauntlet gave the same graph and snapshots on 3 reruns; the calendar app (227 steps, `now` fixed) on 2 reruns.
