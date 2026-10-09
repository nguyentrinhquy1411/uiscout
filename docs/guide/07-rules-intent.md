# 7. Business rules and intent files

The generic oracles know whether the app is broken. Rules say whether it does the right thing: an empty cart can't be ordered, a guest never reaches checkout, an error toast goes away by itself.

> Rule files import `uiscout/rules`, so install uiscout in the app (option B in [install](01-install.md)).

## Writing rules

Create any file named `*.rules.ts` (or `.js`, `.mjs`) in the app. Every export is a rule; the export's name is the rule's name.

```ts
// src/cart/cart.rules.ts
import { always, eventually, state, when } from 'uiscout/rules'

// A plain invariant: true in every state.
export const countNeverNegative = always(() => ((state.read('cart.count') as number) ?? 0) >= 0)

// An implication: whenever the condition holds, the consequence holds right then.
export const emptyCartDisablesOrder = always(
  when(() => state.read('cart.count') === 0)
    .then(() => state.element('cart.order').disabled),
)

// A deadline: whenever the condition holds, the consequence follows within 5 s.
export const errorToastClears = always(
  when(() => state.element('cart.toast').visible)
    .then(eventually(() => !state.element('cart.toast').visible).within(5, 'seconds')),
)

// Per persona: a guest never reaches checkout.
export const guestCannotCheckout = always(
  when(() => state.context.is('guest')).then(() => !state.node.is('/checkout')),
)
```

## What `state` reads

| Expression | Returns |
| --- | --- |
| `state.context.is('guest')` | Whether that's the current context |
| `state.node.is('/checkout')` | Whether the current screen has that ID |
| `state.node.is('/products*')` | Whether the current screen starts with that prefix |
| `state.node.id` | The current screen's ID |
| `state.url` | Path and query |
| `state.element(id).visible` / `.exists` | Whether the element is shown |
| `state.element(id).disabled` | Whether it's disabled |
| `state.element(id).name` | Its visible name |
| `state.read(key)` | A value the app exposes (below) |

The `id` for `state.element` is:
- the element's `data-testid` (recommended), or its `data-scout-id` from the [plugin](10-plugin-affected.md);
- or a fingerprint ID such as `/cart.button:place-order@main` (see `graph.json`, or the graph page's panel).

Elements with a `data-testid` are seen **even when they aren't interactive** (toasts, badges, counters).

## Exposing values to rules

In the app (in test builds, or always: it costs nothing when the runner isn't there):

```ts
// The runner creates window.__uiscout before the app loads; production never has it.
const hook = (window as { __uiscout?: { read?: () => Record<string, unknown> } }).__uiscout
if (hook) hook.read = () => ({ 'cart.count': cart.items.length, 'user.role': session.role })
```

`read()` is called every time a state is captured, so return current values, not a cached copy.

## When rules are checked

- In `check`: on every path walked. A path is a sequence of states: on load, after each step of the path, before and after the action, and after the clock fast-forward.
- In `fuzz`: on random walks ([fuzzing](08-fuzz.md)).

`within()` uses the page's clock, fast-forwards included, so nothing actually waits.

## Results

```text
Errors (1)
  rule         emptyCartDisablesOrder: condition held on /cart.html but the consequence did not
               at /cart.html → click /cart.html.button:add-item@main
               via load → click … → (before)
```

- A violation is an **error**, with the steps that led to it (`via`).
- A rule that throws is reported as `threw: …`, not swallowed.
- An `eventually` still open when a path ends before its deadline is inconclusive and not reported.

## Intent files: business rules in plain language

Put an `*.intent.md` next to the module. Each bullet is a sentence about the business, linked to a rule in a comment:

```md
# Cart

- An empty cart disables "Place order".     <!-- rule: emptyCartDisablesOrder -->
- The error toast goes away by itself.      <!-- rule: errorToastClears -->
- The item count is never negative.         <!-- rule: countNeverNegative -->
- Checkout needs a login.                   <!-- rule: pending -->
- A coupon applies once.
```

The report shows **intent coverage**:

```text
Intent coverage 2 of 5 lines
  ✗ failing   src/cart/cart.intent.md:3  An empty cart disables "Place order".  (emptyCartDisablesOrder)
  ✓ linked    src/cart/cart.intent.md:4  The error toast goes away by itself.  (errorToastClears)
  ✓ linked    src/cart/cart.intent.md:5  The item count is never negative.  (countNeverNegative)
  · pending   src/cart/cart.intent.md:6  Checkout needs a login.
  · pending   src/cart/cart.intent.md:7  A coupon applies once.
```

| State | Meaning |
| --- | --- |
| `linked` | The rule ran on at least one path and passed |
| `failing` | The rule broke |
| `pending` | No rule yet (`rule: pending` or no comment) |
| `stale` | Names a rule no file exports: a warning |
| `unchecked` | The rule exists but no path reached it |

A workflow that works: product people write the sentences, developers write the rules and link them, both are reviewed in the pull request.

## Notes

- Rules and intent files are found under the config's directory, or `root` when the config sets it (skipping `node_modules`, `.git`, `dist`, `build`, `.uiscout`, `coverage`), wherever the command is run from.
- `--no-rules` turns rules and intent coverage off.

Next: [Fuzzing](08-fuzz.md).
