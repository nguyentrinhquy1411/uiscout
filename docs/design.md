# Graph-Driven Frontend Testing — Design Doc

Oct 6, 2026 · @Nguyễn Trinh Quý

## 1. Summary

The tool derives a graph of a frontend from its source code, drives Playwright along every edge, and judges each step with three deterministic oracles. Results land on the pull request as a graph diff plus a list of failures per edge. AI can propose additions, but nothing that gates a merge depends on a model.

This doc uses `flowcheck` as a placeholder name in commands and package names. The real name is an open question.

### Goals

- **First value with no spec.** One command on an existing React app yields a graph and a list of real defects.
- **Lives in the repo.** Graph, rules, snapshots and API recordings are versioned files, reviewed in pull requests.
- **Deterministic in CI.** The same commit gives the same result, with no model calls.
- **Business knowledge is first-class.** Teams write plain-language notes per module, and those notes become executable rules.
- **AI-ready, not AI-dependent.** Agents read the graph and the results over MCP and can propose edges, scenarios and rules.

### Non-goals

- Backend correctness. API and contract tests own that.
- Replacing hand-written E2E tests for critical flows on day one.
- Re-implementing graph extraction where an open tool already does it.
- Mobile in v1. Web React comes first.

### Design principles

1. The value is in the oracles, not in the graph.
2. Everything that gates a merge is deterministic.
3. Every fact in the graph carries its provenance: who or what established it, and when.
4. Semantic IDs are permanent, bindings are replaceable. A test ID, a role and name, or a WebMCP tool are all just ways to reach the same element.
5. Noise kills adoption. A report must be short and true, or the team turns the tool off.

## 2. Concepts

Twelve terms carry the whole design.

| Term | Meaning |
| --- | --- |
| Node | A screen or a distinct UI state: a route, an open modal, a selected tab. |
| Element | An interactive control inside a node, identified by a stable semantic ID. |
| Edge | An action on an element that moves the app to another node, or changes state inside the same node. |
| Guard | The condition under which an edge exists: a role, a feature flag, a data state. |
| Context | A named combination of persona, data fixture and flags under which the graph is walked. |
| Oracle | A check that decides whether a step is correct. |
| Trust tier | How an edge is known: `static`, `observed`, `declared` or `proposed`. |
| Binding | A concrete way to find an element: test ID, role and name, fingerprint, WebMCP tool. |
| Adapter | Code that exposes the semantic actions and the readable state of a complex widget. |
| Recording | The API responses captured while an edge was walked against a real backend. |
| Baseline | A structural snapshot and component screenshot accepted as correct. |
| Safety label | `safe`, `mutating` or `destructive`. It decides whether the runner may walk an edge. |

## 3. Architecture

Five pipeline steps run in order, reading and writing files that live in the repo. AI proposals enter only through those files.

&#91;embedded content: architecture · 5 pipeline steps, repo files, optional AI\]

The Check step is highlighted because it is the product. Everything before it prepares a state to judge, and everything after it reports the verdict.

### Layers

| Layer | Responsibility | Needs AI | Section |
| --- | --- | --- | --- |
| 1. Identity | Stable semantic IDs and fingerprints for elements | No | 4 |
| 2. Graph | Nodes, edges, guards, trust tiers, contexts | No | 5 |
| 3. Runner | Walks edges in Playwright with replayed network | No | 6 |
| 4. Oracles | Generic checks, invariants, baselines; widget adapters; intent files | No | 7, 8, 9 |
| 5. AI plug-ins | Proposes edges, drafts rules, triages diffs | Optional | 11 |
| 6. Lifecycle | Graph as lockfile, pull request report, schedules | No | 10 |

### Data flow

1. **Build.** The plugin stamps each interactive element with a semantic ID.
2. **Map.** Static analysis produces nodes and edges with source witnesses and writes `app.graph.json`.
3. **Run.** The runner plans paths that cover the selected edges and walks them, serving API responses from recordings.
4. **Check.** After every step the three oracle families judge the new state.
5. **Report.** The graph diff, failures per edge and coverage go to the pull request. Blocking failures set the check status.

## 4. Identity layer

Every interactive element gets a stable semantic ID at build time, plus a fingerprint used to find it again when the UI changes.

### ID scheme

An ID has the form `<module>.<Component>.<role>`, for example `checkout.CartSummary.submit`. It is derived from the file path, the component name, and the element's role or handler name. It is never derived from position or index, because those change on every refactor.

Repeated items share one template ID and carry a runtime key, for example `orders.OrderRow.open` with `data-fc-key="A-1042"`. A `data-testid` written by a developer always wins over a generated ID.

### Injection

A build plugin (Babel or SWC, wired into Vite and Next) adds a `data-fc-id` attribute to interactive elements. It runs in development and test builds by default. Whether production builds keep the attribute is an open question, because the post-deploy usage overlay needs it.

### Fingerprint and healing

The graph stores a fingerprint per element: role, accessible name, visible text, tag, source `file:line`, parent chain and a coarse position bucket.

When an ID is missing at run time, the runner scores every candidate element by weighted similarity across those attributes and takes the best match above a threshold. This is the [Similo](https://research.chalmers.se/publication/536319) approach, which needs no model and adds a few milliseconds per lookup. A healed lookup is always reported as a warning, never applied silently.

### Renames

When a component is renamed, its IDs change. The graph diff matches old and new elements by fingerprint and reports a rename, so baselines and rules follow the element instead of being deleted and recreated.

### Future bindings

The semantic ID is the stable key. A WebMCP tool name can be added later as one more binding on the same element, without touching rules or baselines.

## 5. Graph layer

The graph is one JSON file committed to the repo. Static analysis drafts it, the runner confirms it, and people can declare what the code cannot show.

### Schema

```json
{
  "version": 1,
  "nodes": [
    { "id": "cart", "route": "/cart", "source": "src/cart/CartPage.tsx:12" },
    { "id": "checkout", "route": "/checkout", "guard": "auth.loggedIn" }
  ],
  "elements": [
    {
      "id": "cart.CartSummary.submit",
      "node": "cart",
      "role": "button",
      "name": "Place order",
      "fingerprint": { "tag": "button", "text": "Place order", "source": "src/cart/CartSummary.tsx:48" }
    }
  ],
  "edges": [
    {
      "id": "cart->checkout:submit",
      "from": "cart",
      "to": "checkout",
      "action": { "type": "click", "element": "cart.CartSummary.submit" },
      "guard": "cart.items > 0",
      "safety": "safe",
      "trust": "observed",
      "witness": { "static": "src/cart/CartSummary.tsx:52", "run": "2026-10-06T09:12Z" },
      "api": ["POST /api/orders/preview"]
    }
  ]
}
```

### Where edges come from

| Source | How | Strength | Weakness |
| --- | --- | --- | --- |
| Static | AST analysis of routes, links, `navigate()` calls and handlers | Complete for declared routes, cheap, has a `file:line` witness | Misses dynamic navigation and data-dependent branches |
| Observed | The runner sees the transition happen in a real browser | Ground truth | Only covers what was walked |
| Declared | A person adds the edge in an intent or override file | Captures business rules | May not be implemented yet |
| Proposed | An agent suggests it | Finds what static analysis missed | Unverified until the runner confirms it |

The static stage favours recall: it keeps uncertain candidates and lets the runner prune them. For the static tier, reuse [uigraph](https://github.com/kanetran29/uigraph) or stay compatible with its format instead of writing new extractors.

### Reading trust combinations

| Combination | What it means |
| --- | --- |
| Static and observed | Confirmed behaviour. |
| Static only | Not walked yet, or unreachable in the current contexts. |
| Observed only | Dynamic navigation the extractor cannot see. Worth an extractor fix. |
| Declared only | A business rule with no implementation behind it. |
| Proposed | Quarantined. It has no effect on tests or coverage. |

### State abstraction

A node's identity is its route plus the set of landmark elements visible on it. Data values are ignored. Three rules keep the graph small:

1. A list collapses to one template item.
2. Data variants are contexts, not nodes.
3. A modal, drawer or tab is a node only if it has its own interactive elements.

### Contexts

`flowcheck.contexts.yaml` names the personas and fixtures the graph is walked under, for example `guest`, `member` and `admin`, each with its own login script and data seed. Guards are evaluated per context, so the same button can lead to different nodes for different roles.

### Safety labels

Each edge is `safe`, `mutating` or `destructive`. The default comes from the HTTP methods observed on the edge and from verbs in the control's name such as delete, remove, pay and send. A developer can override it. The runner skips destructive edges unless it runs in replay mode or in an environment flagged as isolated.

### Diffing

`flowcheck diff` compares two graph versions and reports nodes and edges added, removed and renamed, plus any change of guard, safety label or trust tier.

## 6. Runner

The runner turns the graph into Playwright runs that walk every reachable edge once per context, with the network served from recordings.

### Path planning

The planner computes a set of paths from the entry nodes that covers every edge: it repeatedly takes the shortest path to the nearest uncovered edge. Each path runs as one isolated test in a fresh browser context. `flowcheck gen` writes the same paths out as plain Playwright spec files, so a team can eject at any time.

### Step protocol

Every edge is walked the same way:

1. Locate the element by ID, falling back to the fingerprint.
2. Take the pre-state snapshot.
3. Perform the action.
4. Wait for quiescence: no pending requests, no DOM mutations for a short window, no running animations.
5. Take the post-state snapshot.
6. Run the oracles.

Quiescence replaces fixed timeouts, which are a well-known source of flaky UI tests.

### Network modes

| Mode | Backend | Used for | Behaviour |
| --- | --- | --- | --- |
| `record` | Real | Creating or refreshing recordings | Saves each request and response against the edge that caused it. |
| `replay` | None | Every pull request | Serves responses from recordings. An unmatched request is reported as a stale recording. |
| `live` | Staging | Nightly | Hits the real backend and reports responses whose shape differs from the recording. |

Replay mode is what makes pull-request runs fast and stable, and it makes mutating and destructive edges safe to walk. [Meticulous](https://app.meticulous.ai/docs/concepts/architecture-overview) uses the same record-once, replay-forever idea for user sessions.

### API attribution

Every request made during a step is attributed to that step's edge and stored in the edge's `api` list. A failed request is therefore reported as "clicking Place order on the cart called `POST /api/orders/preview`, which returned 500". The same list answers the reverse question: which screens depend on a given endpoint.

### Determinism controls

- Frozen clock and seeded randomness.
- Animations and transitions disabled.
- Fixed viewport, locale and time zone.
- Fonts bundled with the runner image.

### Auth and seed data

Each context has a login script that runs once and saves a Playwright `storageState`. Replay mode needs no seed data. Record and live modes call a `seed` hook per context before the run.

### Flake policy

A failed step is retried once in a fresh context. If it passes on retry, it is reported as flaky in a separate list and does not fail the gate. The report attaches the trace difference between the failing and the passing run, so the cause can be found instead of ignored.

## 7. Oracles

Three oracle families decide pass or fail on every edge, and all three are deterministic. This layer is the product; the other layers exist to feed it.

### A. Generic checks

These need no spec and run on every step.

| Check | Fails when | Default severity |
| --- | --- | --- |
| Script errors | An uncaught exception, an unhandled rejection or a `console.error` occurs during the step | Error |
| Error boundary | A registered error-boundary fallback is rendered | Error |
| Network | A request returns 5xx, returns a 4xx that is not allow-listed, or times out | Error |
| Transition | The action does not reach the node the graph says it should | Error |
| Dead control | An element in the graph is hidden, disabled without a guard, covered by another element, zero-sized or outside the viewport | Error |
| Layout geometry | Sibling controls overlap, an element protrudes from its container, or text is clipped | Warning |
| Accessibility | An axe rule of serious or critical impact is violated | Warning |

The layout checks follow the failure types catalogued in layout-bug research: overlapping, misaligned and protruding elements. They run on the structural snapshot, so they need no screenshot and no model.

### B. Invariants

Invariants are rules that must hold on every path. They are written in TypeScript with two temporal operators, `always` and `eventually`, and evaluated over the sequence of states the runner observes.

```ts
import { always, eventually, when, state } from "@flowcheck/rules";

export const guestCannotCheckout = always(
  when(() => state.context.is("guest"))
    .then(() => !state.node.is("checkout"))
);

export const emptyCartDisablesOrder = always(
  when(() => state.read("cart.count") === 0)
    .then(() => state.element("cart.CartSummary.submit").disabled)
);

export const errorToastClears = always(
  when(() => state.element("app.Toast.error").visible)
    .then(eventually(() => !state.element("app.Toast.error").visible).within(5, "seconds"))
);
```

Invariants run in two modes. On pull requests they are checked along the planned paths. Nightly, `flowcheck fuzz` takes seeded random walks over the graph and checks the same rules, which finds action sequences nobody planned.

This is property-based testing applied to UIs, the approach of Quickstrom and its successor [Bombadil](https://wickstrom.tech/2026-01-28-there-and-back-again-from-quickstrom-to-bombadil.html). Whether to integrate Bombadil or ship a minimal evaluator is an open question.

### C. Baselines

A baseline is what a node looked like when a person last accepted it. It has two parts.

**Structural snapshot.** A text file per node and context holding the accessibility tree, bounding boxes and a short list of computed styles. Its diff is classified:

| Diff class | Example | Severity |
| --- | --- | --- |
| Element removed | The submit button is gone | Error |
| Role or name changed | A button became a link | Error |
| Element added | A new banner appears | Info |
| Moved or resized past threshold | A panel is 40 px narrower | Warning |
| Style changed | A text colour differs | Info |

**Component screenshots.** One image per component, never per page, with dynamic regions masked. A pixel difference alone is informational. It becomes a warning only when the structural snapshot changed too.

Baselines are updated with `flowcheck accept`, and the changed files are reviewed in the pull request like any other code.

### Gating

| Oracle | Pull request | Nightly |
| --- | --- | --- |
| A, errors | Blocks merge | Reported |
| A, warnings | Comment only | Reported |
| B, planned paths | Blocks merge | Reported |
| B, fuzz | Not run | Opens an issue with the minimal failing sequence |
| C, structural errors | Blocks merge | Reported |
| C, pixel differences | Comment only | Not run |
| Flaky steps | Listed separately, never block | Tracked over time |

## 8. Complex widgets

A complex widget such as a gantt chart is one node with an adapter. The adapter exposes semantic actions and readable state, so the tool never guesses at pixels.

A graph of buttons cannot model a gantt. Its actions are continuous (drag, resize, zoom, scroll), its state depends on data, and many libraries render to canvas or virtualize the DOM.

### Adapter contract

```ts
export interface WidgetAdapter<State, Actions> {
  /** Semantic ID of the widget, e.g. "planning.Gantt". */
  id: string;

  /** Read the widget's semantic state from the page. */
  read(page: Page): Promise<State>;

  /** Semantic actions, implemented with whatever gestures the widget needs. */
  actions: { [K in keyof Actions]: (page: Page, args: Actions[K]) => Promise<void> };

  /** Valid next actions for a given state, used to build random sequences. */
  generate(state: State, rng: Rng): Array<{ action: keyof Actions; args: unknown }>;

  /** Each invariant returns true, or a message describing the violation. */
  invariants: Array<(prev: State, next: State, step: Step) => true | string>;
}
```

### Gantt example

| Part | Content |
| --- | --- |
| State | Tasks with `id`, `start`, `end`, `row` and `dependsOn`, plus the visible date range and zoom level |
| Actions | `moveTask`, `resizeTask`, `linkTasks`, `zoom`, `scrollTo` |
| Invariants | A task never ends before it starts. Each bar's position matches its dates on the time scale within 1 px. Moving one task leaves the duration of every other task unchanged. Zooming changes no task data. A dependent task never starts before its predecessor ends, when that constraint is on. |

### How an adapter reads state

| Rendering | Method |
| --- | --- |
| DOM or SVG | Read attributes and bounding boxes from the elements. |
| Canvas | Call a debug hook the app exposes in test builds, for example `window.__flowcheck.gantt.getState()`. |
| Canvas with no hook | A vision model that detects elements in a screenshot. Last resort, advisory only. |

The debug hook is the durable option. Platforms that render to canvas and still test reliably do it by exposing named handles for their controls.

### How adapters are tested

Each widget gets a harness page that mounts it alone with fixture data. The runner generates seeded random action sequences, checks every invariant after every step, and shrinks a failing sequence to the shortest one that still fails. The seed and the minimal sequence go into the report, so the failure can be replayed exactly.

### Reference adapters

Writing an adapter is real work, so the project should ship reference adapters for a few popular widget libraries. The first one depends on which gantt library the first real user has.

## 9. Business intent files

Teams write what a module must do in plain language. Each line is linked to graph elements and backed by a rule a developer has approved.

### File format

An intent file sits next to the module it describes.

```text
# Checkout

- A guest cannot reach the payment page.                    <!-- rule: guestCannotCheckout -->
- An empty cart disables "Place order".                      <!-- rule: emptyCartDisablesOrder -->
- After payment the user always lands on order confirmation. <!-- rule: pending -->
```

The visible text is for people. The trailing comment is the link to a rule in the module's `rules.ts` file.

### Lifecycle of a line

1. **Written.** Anyone on the team adds a sentence. Its state is `pending`.
2. **Compiled.** A developer writes the rule, or an AI plug-in drafts it from the sentence and the graph.
3. **Reviewed.** The rule is approved in a pull request. The line's state becomes `linked`.
4. **Enforced.** The rule runs as an oracle B invariant on every pull request.
5. **Stale.** If the rule refers to a node or element that no longer exists in the graph, CI flags the line.

### What the report shows

- Intent coverage: the share of lines that are linked to a passing rule.
- Pending lines, as a to-do list for developers.
- Stale lines, as a prompt to update the note or the code.

### Why plain language

Behaviour-driven development asked business people to write a formal syntax, and in many teams developers ended up maintaining it alone. Here the business side writes ordinary sentences and the formal part is owned by developers.

The same files give agents the context they lack. The MCP server serves the intent lines of a module next to its part of the graph.

## 10. CI/CD and lifecycle

On every pull request the tool re-maps the app, walks the affected edges in replay mode, and posts one comment. A full walk and the fuzz run happen nightly.

### Pull request pipeline

1. Build the app with the ID plugin.
2. `flowcheck map` regenerates the graph from source.
3. If the regenerated graph differs from the committed `app.graph.json`, the pull request must include the update, exactly like a lockfile.
4. Select the affected edges (see below).
5. `flowcheck run --mode replay` walks them and runs oracles A, B and C.
6. `flowcheck report` posts or updates one comment and sets the check status.

```yaml
# .github/workflows/flowcheck.yml
name: flowcheck
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npm ci && npm run build:test
      - run: npx flowcheck map --check
      - run: npx flowcheck run --mode replay --affected origin/main
      - run: npx flowcheck report --github
        if: always()
```

### The report

```text
flowcheck: 2 errors, 1 warning, 41 of 44 affected edges walked

Graph diff
  + node   orders/refund
  + edge   orders -> orders/refund : click orders.OrderRow.refund   (static, not yet observed)
  - edge   cart -> promo : click cart.PromoLink.open

Errors
  cart -> checkout : click cart.CartSummary.submit
    Network   POST /api/orders/preview returned 500
  rule emptyCartDisablesOrder   (checkout.intent.md, line 2)
    "Place order" was enabled with cart.count = 0

Warnings
  settings/profile   Layout: profile.Avatar.upload overlaps profile.Form.save

Not walked (3)   destructive, no recording: orders.OrderRow.delete, ...
Flaky (0)
Edge coverage 87% (was 85%)   Intent coverage 12 of 15 lines
```

The comment is capped in length. Everything beyond the cap goes to a linked HTML report.

### Selecting affected edges

Every element and edge carries a `file:line` witness. The selector maps the files changed in the pull request to the elements and nodes defined in them, then takes every edge that touches those nodes plus the edges one step away. A change to shared code, such as a design-system component, selects every edge whose elements import it.

### Schedule

| When | What runs |
| --- | --- |
| Pull request | Map check, affected edges in replay mode, oracles A, B and C |
| Merge to main | Full walk in replay mode, baselines and coverage stored |
| Nightly | Full walk in live mode against staging, fuzz run, recording drift report |
| On demand | `flowcheck record` to refresh recordings after an API change |

### After deploy (later milestone)

Production analytics events that carry the element ID are mapped onto edges, giving each edge a usage weight. The report then ranks untested edges by real traffic and lists edges nobody uses. This turns the graph into a product map as well as a test map.

## 11. AI plug-ins

AI is off by default and plugs in at three points. Its output is always a proposal, and a proposal changes nothing until the runner or a reviewer confirms it.

### The three plug points

| Plug point | Input | Output | Accepted when |
| --- | --- | --- | --- |
| Explore | The graph, uncovered areas, intent lines | Proposed edges and multi-step scenarios | The runner walks the edge and observes the transition |
| Compile intent | A pending intent line plus the module's part of the graph | A draft rule in `rules.ts` | A developer approves it in a pull request |
| Triage | A structural or pixel diff, both snapshots, the pull request description | "Intended change" or "likely defect", with a reason | Never automatic. It only annotates the report |

### The proposal rule

A proposed edge sits in quarantine with trust tier `proposed`. It does not count towards coverage and no test depends on it. Once the runner observes it, it becomes `observed` and joins the graph. A wrong proposal therefore costs one wasted browser run and nothing else. uigraph applies the same rule under the name proof-gated verification.

### Why AI stays advisory

- **As a test generator it is strong.** [AutoE2E](https://arxiv.org/abs/2408.01894v2) reports 79% feature coverage, and [VISCA](https://arxiv.org/pdf/2506.04161) reports 92% after giving the model a component-level abstraction of the page instead of raw HTML. The graph and the structural snapshots are that kind of abstraction, so this tool is a good context source for any agent.
- **As an oracle it is not reliable enough to gate.** A [study on Android apps](https://arxiv.org/pdf/2407.19053) found multimodal models detected 49% of non-crash functional bugs. That is useful as a second opinion and too low to block a merge.

### MCP server

The core ships no model and needs no API key. `flowcheck mcp` starts a stdio server, and the team's own coding agent connects to it.

| Tool | Purpose |
| --- | --- |
| `get_graph`, `get_node` | Read the graph or one node with its elements and edges |
| `plan_path` | Shortest verified path between two nodes |
| `get_uncovered_edges` | Edges with no observation, ranked by usage weight when available |
| `get_failures` | Oracle results from the latest run, per edge |
| `get_intent` | Intent lines and rule states for a module |
| `propose_edge`, `propose_rule` | Add a proposal to quarantine |
| `run_edge` | Ask the runner to walk one edge and return the evidence |

### Vision models

For DOM and SVG apps a vision model adds nothing the structural snapshot does not already give. For a canvas widget with no adapter, a screen-parsing model such as [OmniParser](https://github.com/microsoft/OmniParser) can locate elements in a screenshot. Treat it as a fallback: its detection weights are reported to be AGPL-licensed, which matters for a permissively licensed project.

## 12. Repository layout, packages and CLI

Everything the tool knows about an app is a file in that app's repo.

### In the application repo

```text
flowcheck.config.ts          entry URLs, build command, thresholds, allow-lists
flowcheck.contexts.yaml      personas, login scripts, seed hooks
app.graph.json               the verified graph, committed like a lockfile
src/
  checkout/
    checkout.intent.md       business notes in plain language
    checkout.rules.ts        invariants (oracle B)
  planning/
    gantt.adapter.ts         actions, state and invariants of a complex widget
.flowcheck/
  snapshots/                 structural snapshots and component screenshots
  recordings/                API responses per edge
  proposals/                 quarantined AI proposals, not used by tests
```

### Packages

| Package | Role | Build or reuse |
| --- | --- | --- |
| `@flowcheck/plugin` | Injects semantic IDs at build time | Build |
| `@flowcheck/graph` | Graph format, extraction, diff, path planning | Reuse uigraph where possible |
| `@flowcheck/runner` | Edge walking, quiescence, network record and replay | Build, on Playwright |
| `@flowcheck/oracles` | Generic checks, snapshot diff, layout geometry | Build. This is the core |
| `@flowcheck/rules` | The `always` and `eventually` rule API and its evaluator | Build, or wrap Bombadil |
| `@flowcheck/adapters` | Adapter contract and reference adapters | Build |
| `@flowcheck/ci` | Affected-edge selection, report, GitHub integration | Build |
| `@flowcheck/mcp` | Model-free MCP server | Build, later |
| `@flowcheck/cli` | The commands below | Build |

### CLI

| Command | What it does |
| --- | --- |
| `flowcheck init` | Detects the framework, adds the plugin, writes a starter config |
| `flowcheck map [--check]` | Regenerates the graph. With `--check`, fails if it differs from the committed file |
| `flowcheck record` | Walks the graph against a real backend and saves recordings |
| `flowcheck run [--mode] [--affected <ref>]` | Walks edges and runs the oracles |
| `flowcheck check` | `map` plus `run` in one step, for local use and first-time demos |
| `flowcheck accept [node]` | Accepts current snapshots as the new baseline |
| `flowcheck diff <a> <b>` | Structural diff between two graph versions |
| `flowcheck fuzz [--seed]` | Seeded random walks checking invariants |
| `flowcheck gen` | Writes the planned paths as plain Playwright spec files |
| `flowcheck report [--github]` | Renders the latest run as text, HTML or a pull request comment |
| `flowcheck mcp` | Starts the MCP server |

### The five-minute path

The first experience decides adoption, so it must need no setup beyond a running app:

```text
npx flowcheck check --url http://localhost:3000
```

With no plugin installed and no recordings, this falls back to fingerprints for identity and a live backend for the network, and walks only edges it can label safe. It still produces a graph and the oracle A findings, which is enough to show value before asking for any change to the codebase.

## 13. Roadmap

Seven milestones, each gated by an exit criterion. Nothing after M1 matters if M1 does not find real defects on real apps. The numeric targets are proposals to be adjusted after M0.

| Milestone | Scope | Exit criterion |
| --- | --- | --- |
| M0 Spike | Run uigraph on one real React app. Count edges by hand on five screens and compare. | A written decision: reuse its format directly, or keep an own schema with import and export. |
| M1 Zero-spec check | Runner, quiescence, oracle A, fingerprint identity, text report. `npx flowcheck check` works on an unmodified app. | At least one confirmed real defect on each of three open-source apps, with under 10% false positives. |
| M2 Baselines and pull requests | ID plugin, record and replay, oracle C, graph diff, affected-edge selection, GitHub comment. | One real repo runs it on every pull request for two weeks without the team disabling it. |
| M3 Rules and intent | Rule API, oracle B on planned paths, intent files, intent coverage, fuzz mode. | Ten intent lines linked to passing rules in one module of a real app. |
| M4 Widget adapters | Adapter contract, harness pages, sequence shrinking, one reference gantt adapter. | The gantt adapter finds a seeded bug that no button-level edge can reach. |
| M5 Agents | MCP server, the three AI plug points, proposal quarantine. | An agent's proposed edges are confirmed by the runner at a measured rate, and that rate is published. |
| M6 Usage overlay | Production events mapped to edges, usage-weighted coverage, dead-edge report. | The report ranks untested edges by real traffic on one deployed app. |

### How to launch

Publish after M1, not later. Run the tool on several well-known open-source apps, report the defects upstream, and write up what was found. Confirmed bugs in projects people know are the strongest argument a testing tool can make.

## 14. Risks and open questions

The largest risk is noise: a report that cries wolf gets the tool switched off within a week, whatever else it can do.

### Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Noisy reports | Teams disable tools they stop trusting | Strict default severities, flaky steps listed apart, capped comment length, pixel diffs never block |
| Static extraction misses dynamic navigation | Coverage looks higher than it is | Runtime observation, declared edges, and loud reporting of anything the extractor could not resolve |
| State explosion | Runs become slow and graphs unreadable | Strict abstraction rules, data variants as contexts, lists collapsed to templates |
| Stale recordings | Replay passes while the real API has changed | Unmatched-request detection, nightly live run, one-command re-record |
| Overlap with uigraph | Its graph engine is open, and its commercial layer generates E2E suites | Differentiate on oracles, stay format-compatible, consider contributing upstream instead of forking the idea |
| Adapter cost | Canvas widgets need hand-written adapters | Reference adapters for popular libraries, a small contract, a debug-hook convention |
| ID churn on refactor | Baselines and rules lose their target | Fingerprint-based rename detection in the graph diff |
| Ownership of code | Work tested against an employer's product may belong to the employer | Clarify ownership in writing before publishing |

### Open questions

- [ ] What is the project's name?
- [ ] Reuse the uigraph format directly, or keep an own schema with import and export? M0 decides.
- [ ] Integrate Bombadil for invariants, or ship a minimal evaluator?
- [ ] Should production builds keep the `data-fc-id` attribute? The usage overlay needs it; some teams will refuse it.
- [ ] Which router comes first: react-router or Next.js?
- [ ] Which license: MIT or Apache-2.0?
- [ ] Does the first gantt to support render with DOM, SVG or canvas?
- [ ] How are recordings kept small and free of personal data in a public repo?

## 15. Prior art and references

Each layer of this design borrows from existing work. Figures quoted in this doc are as reported by the authors. The uigraph README and the Bombadil announcement were read in full; the papers were read at abstract level and should be checked before being cited elsewhere.

### Tools

| Work | What this design takes from it |
| --- | --- |
| [uigraph](https://github.com/kanetran29/uigraph) | Deterministic graph extraction with `file:line` witnesses, trust tiers, proposals that need runtime proof, a model-free MCP server |
| [wirenav](https://github.com/rahXephonz/wirenav) | A navigation graph committed as a file, with CI failing on drift |
| [Playwright test agents](https://currents.dev/posts/state-of-playwright-ai-ecosystem-in-2026) | The planner, generator and healer roles that an agent can play on top of the graph |
| [Bombadil](https://wickstrom.tech/2026-01-28-there-and-back-again-from-quickstrom-to-bombadil.html) | Temporal properties in TypeScript, checked while a fuzzer explores the UI |
| [Meticulous](https://app.meticulous.ai/docs/concepts/architecture-overview) | Record API responses once and replay them, so frontend tests need no backend |
| [OmniParser](https://github.com/microsoft/OmniParser) | Screenshot parsing as a fallback for canvas widgets without an adapter |
| [WebMCP](https://mcpplaygroundonline.com/blog/what-is-webmcp) | A possible future binding: pages declaring tools for agents. Still an origin trial and a draft |

### Research

| Work | What this design takes from it |
| --- | --- |
| [LLMVue](https://arxiv.org/abs/2606.27665) | A page transition graph extracted from Vue source, with a high-recall static stage refined afterwards |
| [ProMal](https://conf.researchr.org/details/icse-2022/icse-2022-papers/1/Promal-Precise-Window-Transition-Graphs-for-Android-via-Synergy-of-Program-Analysis-) | Build the graph statically, then verify each transition dynamically |
| [Empirical study of web GUI testing](https://arxiv.org/pdf/2606.16650) | State abstraction decides how well model-based exploration works |
| [Similo](https://research.chalmers.se/publication/536319) | Locating elements by weighted similarity over many attributes |
| [ReDeCheck](https://eprints.whiterose.ac.uk/id/eprint/116991/1/c49.pdf) | Detecting layout failures such as element collisions without a model |
| [Quickstrom](https://arxiv.org/abs/2203.11532v1) | Property-based acceptance testing of web UIs with temporal logic |
| [AutoE2E](https://arxiv.org/abs/2408.01894v2) and [VISCA](https://arxiv.org/pdf/2506.04161) | Feature-driven E2E test generation; component abstraction as model context |
| [LLMs as oracles for non-crash bugs](https://arxiv.org/pdf/2407.19053) | Evidence that a model oracle should advise, not gate |
| [VLMs on canvas visual bugs](https://arxiv.org/abs/2501.09236v1) | Vision models help with context but vary widely between screenshots |
| [Flaky tests at Microsoft](https://www.microsoft.com/en-us/research/publication/root-causing-flaky-tests-in-a-large-scale-industrial-setting/) | Find root causes by comparing logs of passing and failing runs |
