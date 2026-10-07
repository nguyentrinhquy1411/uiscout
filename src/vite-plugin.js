import path from 'node:path'
import MagicString from 'magic-string'
import { parseSync } from 'oxc-parser'

/*
 * The identity plugin (design doc §4): stamps every interactive JSX element with
 *
 *   data-fc-src="src/features/cart/CartSummary.tsx:48"   where it is in the source
 *   data-fc-id="cart.CartSummary.submitOrder"             a stable semantic ID, when one can be derived
 *
 * The source is the witness that maps a changed file to the screens it touches
 * (affected-edge selection, §10). The ID is <module>.<Component>.<hint>, from the
 * file path, the enclosing component and the handler or label — never from position.
 * A data-testid the developer wrote always wins.
 *
 * Plain JavaScript on purpose: Node won't strip types from files under node_modules,
 * and a Vite config imports this file directly.
 *
 *   // vite.config.ts
 *   import { flowcheckIds } from 'flowcheck/vite'
 *   plugins: [mode === 'test' && flowcheckIds(), react()]
 */

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label'])
const HANDLERS = /^on(Click|DoubleClick|KeyDown|KeyUp|Submit|Change|Input|PointerDown|MouseDown)$/

/**
 * @param {{ include?: RegExp, root?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function flowcheckIds(options = {}) {
  const include = options.include ?? /\/src\/.*\.[jt]sx$/
  let root = options.root ?? process.cwd()
  return {
    name: 'flowcheck-ids',
    enforce: 'pre',
    configResolved(config) {
      root = options.root ?? config.root
    },
    transform(code, id) {
      const file = id.split('?')[0]
      if (!include.test(file) || !code.includes('<')) return null
      return stampIds(code, path.relative(root, file).split(path.sep).join('/'), file)
    },
  }
}

/**
 * The transform itself, exported for tests and other bundlers.
 * @param {string} code
 * @param {string} relPath  file path relative to the project root, with forward slashes
 * @param {string} [file]    absolute path, for the source map
 * @returns {{ code: string, map: import('magic-string').SourceMap } | null}
 */
export function stampIds(code, relPath, file = relPath) {
  const { program, errors } = parseSync(relPath, code)
  if (errors.length) return null
  const lineStarts = [0]
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (offset) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const module = moduleOf(relPath)
  const s = new MagicString(code)
  let changed = false

  /** @param {any} node @param {string} component */
  const visit = (node, component) => {
    if (!node || typeof node.type !== 'string') return
    const name = componentName(node) ?? component
    if (node.type === 'JSXElement') {
      const stamp = stampFor(node, name, module, relPath, lineOf)
      if (stamp) {
        s.appendLeft(node.openingElement.name.end, stamp)
        changed = true
      }
    }
    for (const key in node) {
      if (key === 'parent') continue
      const child = node[key]
      if (Array.isArray(child)) for (const c of child) visit(c, name)
      else if (child && typeof child === 'object' && typeof child.type === 'string') visit(child, name)
    }
  }
  visit(program, '')
  return changed ? { code: s.toString(), map: s.generateMap({ hires: true, source: file, includeContent: true }) } : null
}

/** "src/features/cart/CartSummary.tsx" → "cart"; "src/components/ui/button.tsx" → "ui". */
function moduleOf(relPath) {
  const parts = relPath.replace(/\.[jt]sx$/, '').split('/')
  const features = parts.indexOf('features')
  if (features >= 0 && parts[features + 1]) return parts[features + 1]
  return parts.at(-2) && parts.at(-2) !== 'src' ? parts.at(-2) : parts.at(-1)
}

/** The component a node declares, if it declares one: function Foo, const Foo = () =>. */
function componentName(node) {
  if (node.type === 'FunctionDeclaration' && node.id && /^[A-Z]/.test(node.id.name)) return node.id.name
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && /^[A-Z]/.test(node.id.name)) {
    const init = node.init
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression' || init.type === 'CallExpression')) return node.id.name
  }
  return null
}

function stampFor(node, component, module, relPath, lineOf) {
  const opening = node.openingElement
  const tag = opening.name.type === 'JSXIdentifier' ? opening.name.name : opening.name.type === 'JSXMemberExpression' ? opening.name.property.name : null
  if (!tag) return null
  const attrs = opening.attributes.filter((a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier')
  const has = (n) => attrs.some((a) => a.name.name === n)
  if (has('data-fc-src')) return null
  const intrinsic = /^[a-z]/.test(tag)
  const handler = attrs.find((a) => HANDLERS.test(a.name.name))
  const interactive = intrinsic
    ? INTERACTIVE_TAGS.has(tag) || Boolean(handler) || has('role') || has('tabIndex')
    : Boolean(handler) || has('href') || has('to') || /Button|Link|Trigger|Item|Tab|Checkbox|Switch|Toggle/.test(tag)
  if (!interactive) return null

  let stamp = ` data-fc-src="${relPath}:${lineOf(opening.start)}"`
  if (!has('data-testid') && !has('data-fc-id')) {
    const hint = hintOf(handler, attrs, node)
    if (hint && component) stamp += ` data-fc-id="${module}.${component}.${hint}"`
  }
  return stamp
}

/** What the control does or says: its handler's name, its label, or its literal text. */
function hintOf(handler, attrs, node) {
  const expr = handler?.value?.type === 'JSXExpressionContainer' ? handler.value.expression : null
  const fromExpr = (e) => {
    if (!e) return null
    if (e.type === 'Identifier') return e.name
    if (e.type === 'MemberExpression' && e.property.type === 'Identifier') return e.property.name
    if ((e.type === 'ArrowFunctionExpression' || e.type === 'FunctionExpression') && e.body) {
      const call = e.body.type === 'CallExpression' ? e.body : e.body.type === 'BlockStatement' && e.body.body.length === 1 && e.body.body[0].type === 'ExpressionStatement' ? e.body.body[0].expression : null
      if (call?.type === 'CallExpression') {
        const callee = fromExpr(call.callee)
        // navigate('/checkout') says more than navigate: two buttons share the function, not the target.
        const target = call.arguments[0]?.type === 'Literal' && typeof call.arguments[0].value === 'string' ? camel(call.arguments[0].value) : null
        return callee && target ? `${callee}${target[0].toUpperCase()}${target.slice(1)}` : callee
      }
    }
    return null
  }
  const named = fromExpr(expr)
  const label = attrs.find((a) => a.name.name === 'aria-label' && a.value?.type === 'Literal')
  const text = node.children.filter((c) => c.type === 'JSXText').map((c) => c.value).join(' ').trim()
  const said = label ? camel(label.value.value) : text && text.length <= 40 ? camel(text) : null
  // A state setter (setZoom) says less than the label ("Zoom in"): two buttons share it.
  if (named && /^set[A-Z]/.test(named) && said) return said
  if (named && !/^(set|handle|on)$/.test(named)) return camel(named.replace(/^(handle|on)(?=[A-Z])/, ''))
  return said
}

function camel(s) {
  const words = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!words.length) return null
  return words.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('').slice(0, 40)
}
