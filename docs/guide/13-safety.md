# 13. Safety and sensitive data

uiscout really clicks. Before running it where there is real data, know what it **won't** do and what risk remains.

## What it never does

| Action | How it's prevented |
| --- | --- |
| Click something destructive | Controls named delete, remove, erase, wipe, destroy, discard, clear, reset, sign out, log out, unsubscribe, pay, purchase, send (and their Vietnamese equivalents) are skipped in `live` and `record` |
| Submit a form through a destructive button with Enter | Fields whose form's default button is destructive are typed into, never submitted |
| Click the wrong control when finding one again | Two controls with different names never match; before every action, safety is checked again on the element actually found |
| Follow links to other sites | Skipped in live; recorded as `external:` edges |
| Open new tabs | New tabs are closed immediately |

Safety labels come from **names**. A delete button with no clear name (an unlabelled trash icon) might not be recognised. So:
- give icon buttons a clear `aria-label` (accessibility asks for it anyway);
- run against a test environment, or with `--mode replay`; never `live` against production.

## Replay fails closed

In `--mode replay`, every API call, beacon and form POST to any origin is answered from the recordings or stopped. Navigation to other sites gets a stand-in page; WebSockets to other origins are closed.

**Still open:** same-origin GET navigations reach the server. A server-rendered app with a "GET /logout" route still receives it.

## What is written to disk

| File | Contains | Protection |
| --- | --- | --- |
| `uiscout/recordings.json` | API responses | Redacted: emails, tokens, JWTs, bearer values, secret-looking strings; sensitive keys (password, token, session, cookie, auth, phone, email, address, card…) hide **whole values, nested ones included**; form bodies; bodies without a content type; query values in keys |
| `uiscout/app.graph.json`, `snapshots/` | Visible names of controls | Names are redacted when the fingerprint is made (emails, tokens) |
| `.uiscout/screens/*.jpg` | Screenshots | **Pixels can't be redacted.** Off by default in CI; excluded from the example workflow's artifact |
| `uiscout.config.json` | Sign-in steps for `auth` and contexts | Put passwords in `${ENV}` variables, not in the file; use test accounts only |
| Saved sign-in (cookies, storage) | A live session of the test account | A private temporary directory (owner only), deleted when uiscout exits; never in `.uiscout/` |
| `.uiscout/server.log` | The dev server's output (`webServer`) | Left out of the example CI artifact and of `uiscout site` |
| `uiscout-site/` (`uiscout site`) | The graph page, reports; screenshots only with `--screenshots` | Marked `noindex`; host it where only the team can see it |

Before committing:

```sh
git diff uiscout/recordings.json | less     # review the recordings
grep -rE "@[a-z0-9-]+\.[a-z]{2,}" uiscout/  # look for leftover emails
```

## Costs and external services

uiscout also clicks controls that send requests to AI, SMS, email or test payment services when their names don't sound destructive (a chat suggestion that sends straight to a model, for instance). Always block them:

```json
"block": ["**/api/ai/**", "**/api/sms/**", "https://api.stripe.com/**"]
```

## Recommendations

1. Run against a test environment with fake data.
2. A dedicated test account for each context, its password in an environment variable (`${SCOUT_PASSWORD}`).
3. `--mode replay` in CI.
4. No `--screenshots` in CI when the app shows personal data.
5. Review `recordings.json` before committing it.

Next: [Troubleshooting](14-troubleshooting.md).
