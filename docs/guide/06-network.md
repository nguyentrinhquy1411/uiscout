# 6. Network modes: live, record, replay

| `--mode` | Backend | Use it for |
| --- | --- | --- |
| `live` (default) | Real | Local runs, first runs. Destructive controls are never clicked |
| `record` | Real | Walks like live and keeps every API response |
| `replay` | None | Answers from the recordings. Fast, stable, and **walks destructive controls too** |

## Record

```sh
uiscout check --mode record
```

- Every API call (fetch, XHR, EventSource, beacon, form POST) to **any origin** is saved in `uiscout/recordings.json`.
- A recording's key is the method, path and sorted query; calls to another origin include it. Two POSTs to the same path with different bodies are told apart by a hash of the body.
- Before saving, bodies are **redacted**: emails, tokens, JWTs and sensitive keys (password, token, session, phone, address…) including nested values; query values in keys too.
- uiscout reminds you to review the file before committing it.

## Replay

```sh
uiscout check --mode replay
```

- Every API call and form POST is answered from the recordings, **whatever origin it targets**.
- Navigation to another site gets a stand-in page, so the `external:…` edge is still recorded.
- WebSockets to other origins are closed. Same-origin sockets (usually the dev server's hot reload) stay open.
- Only the app's pages and static files (scripts, CSS, images, fonts) load for real.
- A call with no recording gets status 599 and a **warning**: `GET /api/x has no recording (re-record with --mode record)`.

Since nothing reaches a server, replay **walks destructive controls** (delete, log out, pay…) and presses Enter in forms whose default button is destructive.

## Suggested workflow

```sh
uiscout check --mode record --update   # once, against a test backend
uiscout check --mode replay --update   # the baseline, in the mode CI uses
git add uiscout/ && git commit         # after reviewing recordings.json

uiscout check --mode replay            # every time after: fast, no backend
```

When the API changes, record again. Calls reported as "has no recording" tell you which recordings are stale.

## Limits

- Replay still lets **same-origin GET navigations** through. A server-rendered app with a "GET /logout" route still receives it.
- Recordings are static: an app that depends on request order (create, then read back) may see different data than when recorded.

Next: [Business rules and intent files](07-rules-intent.md).
