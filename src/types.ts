/*
 * The graph file (docs/Graph-Driven Frontend Testing — Design Doc.md §5). M1 only
 * produces observed facts: every node and edge here was seen in a real browser.
 */

export type Trust = 'static' | 'observed' | 'declared' | 'proposed'
export type Safety = 'safe' | 'mutating' | 'destructive'
export type Severity = 'error' | 'warning' | 'info'

/** What the page tells us about one interactive element. Collected in the browser. */
export interface RawElement {
  /** Index stamped on the element as data-fc-i for this snapshot only. */
  i: number
  tag: string
  role: string
  name: string
  testId: string | null
  /** Up to four landmark ancestors, outermost first, e.g. "nav>aside". */
  parents: string
  href: string | null
  target: string | null
  disabled: boolean
  /** Where the element is in the app's source (data-fc-src from the identity plugin): "src/x.tsx:42". */
  source: string | null
  /** For a field: the name of the button Enter would press (its form's default submit), if any. */
  submit: string | null
  box: { x: number; y: number; w: number; h: number }
}

export interface Fingerprint {
  tag: string
  role: string
  name: string
  testId: string | null
  parents: string
  /** Coarse position: which of 4×4 viewport cells the centre falls in. */
  cell: string
}

/** One thing the runner does to move the app: the unit of a path and of an edge. */
export type Step =
  | { kind: 'click'; fp: Fingerprint }
  /** Type into a field; press Enter unless that would submit through a destructive button. */
  | { kind: 'fill'; fp: Fingerprint; text: string; enter: boolean }
  /** In-app navigation through the history API, for routes no link reaches. */
  | { kind: 'route'; path: string }

export interface GraphNode {
  id: string
  url: string
  /** Shortest action path from the entry that reaches this node, as readable labels. */
  path: string[]
  /** Contexts (personas) in which this node was reached. */
  contexts: string[]
  /**
   * Source files of the controls on this node (from the identity plugin), so a
   * change to one of them selects this node (affected edges, §10).
   */
  sources?: string[]
}

export interface GraphElement {
  id: string
  node: string
  role: string
  name: string
  fingerprint: Fingerprint
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  action: { type: 'click' | 'fill'; element: string; text?: string } | { type: 'route'; path: string }
  /** Contexts in which this edge was observed. */
  contexts: string[]
  /** The move happened only after timers ran (fast-forwarded), not right after the action. */
  delayed?: boolean
  safety: Safety
  trust: Trust[]
  /** Requests made while the step ran: "GET /api/x 200". */
  api: string[]
}

export interface Graph {
  version: 1
  entry: string
  nodes: GraphNode[]
  elements: GraphElement[]
  edges: GraphEdge[]
}

export interface Finding {
  oracle: 'script' | 'network' | 'dead-control' | 'layout' | 'a11y' | 'transition' | 'structure' | 'rule'
  severity: Severity
  /** Where it happened: an edge id, or "load <node>". */
  at: string
  message: string
  /** For a rule violation: the steps from the entry to the state where it broke. */
  trace?: string[]
}
