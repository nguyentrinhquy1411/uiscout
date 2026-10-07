# 8. Fuzzing

`check` walks systematically: each control once, from each screen. `fuzz` walks **randomly but repeatably**: long sequences in odd orders, to find defects nobody planned for.

```sh
uiscout fuzz --url http://localhost:5173/ --seed 7 --runs 10 --length 25
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed <n>` | random | Seed of the first run; run k uses seed + k. Same seed, same walk |
| `--runs <n>` | 5 | Number of walks, each in a fresh browser context |
| `--length <n>` | 25 | Actions per walk |
| `--block`, `--allow-4xx`, `--mode`, `--baseline`, `--fast-forward`, `--no-rules`, `--out` | as in `check` | |

## What it does

1. Opens the app, picks a random safe element and acts on it (click, or type and Enter).
2. After each step: waits for the page to settle, fast-forwards the clock, checks the **rules** and every error-level generic finding.
3. Stops a walk at its first failure.
4. **Shrinks** it: removes one step at a time and replays; when the same failure still happens, keeps the shorter sequence. Repeats until nothing more can go.

## Results

```text
uiscout fuzz (seed 7): 1 failure

  rule savedToastClears
  seed 7, shrunk from 6 to 1 step:
    1. /cart.html.button:save-draft@main
```

Also written to `.uiscout/fuzz.json`. Exits with 1 when something failed.

**To reproduce:** rerun with the same `--seed`, or follow the shrunk sequence by hand.

## When to use it

- Nightly, not as a pull request gate: its run time varies, and a failure may lie outside the PR's change.
- It's most useful once you have rules: without them it only catches crashes and network errors.

Next: [Widget adapters](09-adapters.md).
