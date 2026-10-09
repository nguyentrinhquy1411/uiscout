# 10. Identity plugins and affected-only runs

Without touching the app, uiscout knows controls by fingerprint (role, name, landmarks, position). The identity plugin (for Vite, webpack and Next.js) adds two things: steadier IDs, and knowing which files each screen is built from. The second lets a pull request walk only the screens it affects.

## Install the plugin

```ts
// vite.config.ts
import { uiscoutIds } from 'uiscout/vite'

export default defineConfig(({ mode }) => ({
  plugins: [mode === 'test' && uiscoutIds(), react()],
}))
```

Run the app in test mode for the plugin to apply: `vite --mode test`, or `vite build --mode test && vite preview`.

| Option | Default | Meaning |
| --- | --- | --- |
| `include` | `.jsx`/`.tsx` files under `src/` | Regex of files to stamp |
| `root` | the Vite root | `data-scout-src` paths are relative to this |

### Next.js (webpack or Turbopack)

```js
// next.config.mjs
import { withUiscout } from 'uiscout/next'

const config = { /* … */ }
export default process.env.UISCOUT ? withUiscout(config) : config
```

Start the app with `UISCOUT=1 next dev` (in `webServer.command`). It keeps the app's own `webpack` function and `turbopack.rules`.

### webpack, Rspack, Create React App (craco)

```js
// webpack.config.js, for test builds
module: {
  rules: [{ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', loader: 'uiscout/webpack' }],
}
```

Same transform and attributes as the Vite plugin; options `root` (default: webpack's context) and `sources`.

## What it adds

Every interactive JSX element (button, a, input, select, textarea; elements with `onClick`, `onKeyDown`, `role` or `tabIndex`; components named like `…Button`, `Link`, `…Trigger`, `…Item`…) gets:

```html
<button data-scout-src="src/features/cart/CartSummary.tsx:48"
        data-scout-id="cart.CartSummary.submitOrder">Place order</button>
```

| Attribute | Made from | Used for |
| --- | --- | --- |
| `data-scout-src` | File path and line | Knowing which files build each screen |
| `data-scout-id` | `<module>.<Component>.<hint>` | A steady ID: relabelling the button keeps it |

The hint comes from, in order: the handler (`onClick={submitOrder}` → `submitOrder`; `() => navigate('/checkout')` → `navigateCheckout`), the `aria-label`, then the button's text. A state setter like `setZoom` gives way to the label. Never from position. Elements with a `data-testid` keep it.

## Affected-only runs

1. Take the baseline with the plugin **on**: `uiscout check --update`. Every screen in `app.graph.json` then lists its `sources`.
2. On a feature branch:

```sh
uiscout check --affected origin/main
```

uiscout takes the files changed since `origin/main` (uncommitted ones included), selects the screens built from them **plus the screens one step before them**, replays the path to each, and judges only that part of the baseline.

```text
  affected: 5 of 10 screens, from 1 changed file
```

It **runs everything**, and says why, when it can't be sure:

| Message | Cause |
| --- | --- |
| `full run: src/store.ts not tied to any screen` | Shared code changed (a store, a hook, shared CSS, a config): it may affect any screen |
| `full run: the baseline has no source witnesses` | The baseline was taken without the plugin |
| `full run: no recorded path to /x` | `paths.json` lacks a path |
| `full run: no baseline to select from` | There's no baseline yet |
| `nothing to walk` | No source file changed (docs only): exits 0 |

Measured on a sample app: a one-file change walked 5 of 10 screens in 25 s instead of 42 s, and found the same errors.

Changed files are read relative to the config's directory, which is also where the plugin's `data-scout-src` paths start (the Vite root, or webpack's context): keep `uiscout.config.json` in the app's package in a monorepo.

Next: [Running in CI](11-ci.md).
