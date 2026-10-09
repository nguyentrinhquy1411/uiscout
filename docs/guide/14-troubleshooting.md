# 14. Troubleshooting

## The command fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Executable doesn't exist … chromium` | Playwright's browser isn't installed | `pnpm exec playwright install chromium` (in CI add `--with-deps`) |
| `SyntaxError` or `ERR_UNKNOWN_FILE_EXTENSION` on a `.ts` file | Node older than 24 | Upgrade to Node 24 |
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | The TypeScript sources were run from inside `node_modules` | Use `pnpm exec uiscout` (the built `dist/`), or run `pnpm build` in the uiscout checkout |
| `Cannot find package 'uiscout'` in a rules or adapter file | uiscout isn't installed in the app | `pnpm add -D link:../uiscout` |
| Prints usage and exits with 2 | No `--url` and no config file, or a mistyped command | Add `--url`, or run `uiscout init` |
| `net::ERR_CONNECTION_REFUSED` | The app isn't running, or the port is wrong | Add `webServer` to the config, or start the app; check the URL |
| `web server "…" exited with code 1 before answering` | The dev command failed | Read `.uiscout/server.log` |
| `web server "…" didn't answer at … within 60s` | Slow first build, or the app listens on another port | Raise `webServer.timeout`; check `webServer.url` |
| `uiscout.config.json uses ${X}, which is not set` | A variable the config needs isn't in the environment | `export X=…`, or set it in CI secrets |
| `sign-in didn't reach /x (stopped at /login)` | Wrong account or password, a captcha, or a `waitFor` the app never goes to | Run with `--headed` to watch the sign-in |

## Odd results

| Symptom | Usual cause | Fix |
| --- | --- | --- |
| One screen, no edges | An overlay blocks the entry (cookie banner, onboarding, modal) | Dismiss it in a context's `setup` (`{ "click": "Accept" }`), or check the app |
| Many `Click failed: … intercepts pointer events` | A transparent layer covers the UI | Look at the element named in the message: often a real defect |
| Many `not-found` | An earlier step changed lasting state (a collapsed sidebar, a tab saved in localStorage) | Resets already use a fresh context; if it persists, report it with `findings.json` |
| Many `layout … overlaps` on a widget that stacks by design | The overlap is intended | `--allow-overlap "<selector>"` |
| `console.error` from a third-party library | Not an app defect | `"ignoreConsole": ["text"]` |
| `GET /api/x returned 401/404` on first load | A session check that's expected to fail | `--allow-4xx "GET /api/x"` |
| 429 from an external API | uiscout calls a real service too often | `--block` that URL |
| Long "Never settled" list | A ticking clock or an endless animation | Normal; it only costs time |
| A failure only in "Flaky" | Depends on what earlier steps did | Doesn't fail the run; look if it repeats |
| Another project's rules were loaded | A config higher up the tree was found | Put a `uiscout.config.json` in the app's package, or set `root` |
| Signed-in screens show the sign-in page, or "Could not reach this node again" | The session expired mid-run, or the app's API rate-limits session checks (every screen opens a new tab) | Check the API's limits for session reads; lower `--concurrency` to confirm |
| `intent line links to rule "x", which no rules file exports` | A rule was renamed or removed | Fix the comment in `*.intent.md` |

## Unstable baselines

A rerun reports a graph diff although nothing changed:

| Sign | Cause | Fix |
| --- | --- | --- |
| Snapshots change dates or times | Real time | `"now": "…"` |
| List items swap order | The app's sort isn't stable (two items with the same key) | Add a tie-breaker to the sort in the app |
| An edge `~` flips destination between runs | Timing (a dialog half opened or closed) | Rerun 2–3 times to confirm; if it's a real app defect, fix the app |
| Many edges `-` disappear | `--max-steps` ran out | Raise `maxSteps` |
| Data differs every run | A real, changing backend | `--mode replay` |

The check: `uiscout check --update`, then `uiscout check` twice; both must say "(no change)".

## Slow runs

| Change | Effect |
| --- | --- |
| `--quick` | Depth 1, no axe, no fast-forward: the fastest useful run |
| `--no-a11y --fast-forward 0` | About 40 % faster |
| `--affected origin/main` | Only the affected screens |
| `--mode replay` | No waiting on a backend |
| Lower `--depth` | Fewer deep screens |
| Run against a build | Faster than a dev server |

Raising `--concurrency` helps little when one screen has many controls: the steps on one screen run one after another.

## Watch it work

```sh
uiscout check --url … --headed --concurrency 1   # a visible browser, one screen at a time
```

Progress lines (`node /x (depth 1) · 3/10 screens · 12/250 actions · 20s · ~12s left`) go to stderr. Every finding, skipped element, healed lookup and flaky step is in `.uiscout/findings.json`.
