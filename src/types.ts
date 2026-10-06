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

export interface GraphNode {
  id: string
  url: string
  /** Shortest action path from the entry that reaches this node. */
  path: string[]
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
  action: { type: 'click'; element: string }
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
  oracle: 'script' | 'network' | 'dead-control' | 'layout' | 'a11y' | 'transition'
  severity: Severity
  /** Where it happened: an edge id, or "load <node>". */
  at: string
  message: string
}
