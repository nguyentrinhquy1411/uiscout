# 5. Baselines: comparing runs

The generic oracles catch "the app is broken". A baseline catches "the app is different from yesterday": a control gone, a link that leads elsewhere, a screen that can't be reached any more.

## The loop

```sh
uiscout check --update          # 1. accept the current state as the baseline
git add uiscout/ && git commit -m "uiscout baseline"

# ... change code ...

uiscout check                   # 2. compare with the baseline
git diff uiscout/               # 3. if the change is intended:
uiscout check --update          #    accept it, review the diff, commit
```

## What a baseline contains

The `uiscout/` directory (change it with `--baseline <dir>` or the `baseline` config key):

| File | Contents | Commit |
| --- | --- | --- |
| `app.graph.json` | Every screen and edge, in a fixed order | Yes |
| `snapshots/<screen>.txt` | One file per screen (and context), one line per control | Yes |
| `paths.json` | How each screen was reached, for running only some screens | Yes |
| `recordings.json` | API responses from `--mode record` ([network](06-network.md)) | Yes, after review |

`git diff uiscout/` is the review: a line gone from a snapshot is a control gone, an edge gone from the graph is a path gone.

## What is reported

| Change | Severity | Example message |
| --- | --- | --- |
| A control is gone | Error | `button "Load data" is gone` |
| A control's role or name changed | Error | `button "Count 0" became button "Counter 0"` |
| An action leads somewhere else | Error | `now leads to /dialog.html, was /` |
| Screens or edges added or removed without `--update` | Error | `uiscout/app.graph.json is out of date (3 nodes or edges changed)` |
| A control moved or resized by more than 16 px | Warning | `button "Save" moved or resized: … → …` |
| A new control | Info | `link "Export" is new` |

The **Graph diff** section at the top of the report lists screens and edges added (`+`), removed (`-`) or retargeted (`~`).

## Compare any two graphs

```sh
uiscout diff old.graph.json new.graph.json   # exits 1 when they differ
```

## Keeping a baseline stable

A baseline is only useful when two runs of the same commit agree. You need:

1. **A fixed time:** `"now": "2026-10-07T09:00:00+07:00"`. Otherwise dates, "today" and a now-line change the snapshots every day.
2. **The same data every run:** fixed seeds, a test database, or the app's demo data.
3. **Nothing that varies blocked:** external APIs, ads, analytics (`block`).
4. **The baseline taken in the mode CI uses:** replay walks more edges than live.

Check stability before committing:

```sh
uiscout check --update
uiscout check          # must say "Graph diff (no change)"
uiscout check          # and again
```

Measured: a React app at depth 2 (31 screens, 352 edges) reran twice with no change.

Still drifting? See [unstable baselines](14-troubleshooting.md#unstable-baselines).

Next: [Network modes](06-network.md).
