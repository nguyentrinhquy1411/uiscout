# 4. The graph page and snapshots

Every `check` writes `.uiscout/graph.html`: a page you open in a browser, offline, showing the whole app as uiscout walked it.

## Open it

```sh
uiscout check --open                              # open it when the run ends
uiscout graph --open                              # reopen the last run's graph, no browser run
uiscout graph uiscout/app.graph.json --open       # look at the committed baseline
uiscout graph path/to/graph.json --out out/ --open  # any graph, page written to out/
open .uiscout/graph.html                          # or open the file directly (macOS)
```

With no argument, `uiscout graph` looks for `.uiscout/graph.json`, then `uiscout/app.graph.json`. When a `findings.json` sits next to the graph, the page shows the findings too.

## Reading the page

```
┌──────────────────────────────────────────────┬──────────────────────┐
│ ENTRY   1 STEP        2 STEPS                │ /cards/stats         │
│ ┌───┐   ┌────────┐    ┌──────────────┐       │ 6 findings           │
│ │ / │──▶│ /cards │──▶ │/cards/stats ⑥│       │ Snapshot [Both|…]    │
│ └───┘   └────────┘    └──────────────┘       │ How to get here      │
│         ┌╌╌╌╌╌╌╌╌╌╌┐                         │ Actions from here    │
│         ╎/ [Search]╎  (dashed = overlay)     │ Ways in              │
└──────────────────────────────────────────────┴──────────────────────┘
```

- **Columns** are steps from the entry. A last "Not linked" column holds screens only reached as seeds.
- **Solid boxes** are screens (routes), **dashed boxes** are overlays (dialogs, menus), a **red border** means errors.
- **Badges** on a box count its errors (red) and warnings (orange).
- The small line in a box, "N out · M in place", counts actions that change screen and actions that stay (switching a tab, typing, toggling).
- **Lines** are actions that change screen; thicker means more controls lead between the two.

Click a screen to highlight what it connects to (outgoing in green, incoming in purple) and open its panel.

## The panel

| Section | Shows |
| --- | --- |
| Findings | Errors and warnings on the screen, with where they happened |
| Snapshot | Screenshot and wireframe (below) |
| How to get here | The actions from the entry to this screen |
| Actions from here | Every action, grouped by destination; `delayed` (moved after the clock fast-forward) and `destructive` tags; the API calls each action made |
| Ways in | Screens with an action leading here; click one to jump to it |

## Snapshots

- **Both** (default): the screenshot taken on arrival, with a box over each control. Green is a button, purple a link, orange a field, grey anything else. Hover a box for its name.
- **Screenshot** or **Wireframe** alone.
- **Click the image** for a full-size view; Esc closes it.
- **"N controls"**: the snapshot as text, in the same format as the baseline files:

```text
button "Save" @main 640,96 80x32
link "Docs" @nav 12,180 36x36 #shell.Rail.docs
```

Each line: role, name, landmark parents (`@main`), position `x,y` and size `wxh` (rounded to 4 px), and the test ID if any (`#…`).

## Screenshots

- Taken by default on your machine, **off by default in CI** (when `CI` is set). `--screenshots` turns them on, `--no-screenshots` off.
- Saved as `.uiscout/screens/*.jpg`, about 30–40 KB each.
- A baseline keeps only the structure, so viewing a baseline shows wireframes.
- They show whatever the app shows, personal data included: see [safety](13-safety.md).

## Sharing

`graph.html` with the `screens/` folder next to it is all someone else needs. `graph.html` alone still shows the graph, without screenshots.

Next: [Baselines](05-baseline.md).
