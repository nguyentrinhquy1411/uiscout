import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Finding, Graph } from './types.ts'

/*
 * The graph as a page you can open (flowcheck graph --open): screens in columns by
 * distance from the entry, findings on the screens they were seen on, and an
 * inspector for each screen's path, actions, API calls and ways in. One
 * self-contained HTML file; the data is embedded, nothing is fetched.
 */

const TEMPLATE = path.join(import.meta.dirname, 'graph-view.html')
const MARKER = '/*__FLOWCHECK_DATA__*/null'

export interface GraphViewData {
  graph: Graph
  /** Findings of the run that produced the graph, or null for a baseline on its own. */
  findings: Finding[] | null
  /** Shown in the header, e.g. "baseline flowcheck/app.graph.json". */
  label: string
  source: string
}

export async function renderGraphHtml(data: GraphViewData): Promise<string> {
  const template = await readFile(TEMPLATE, 'utf8')
  // JSON inside <script>: escape "<" so a name like "</script>" can't end the block.
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  if (!template.includes(MARKER)) throw new Error('graph-view.html is missing its data marker')
  return template.replace(MARKER, json)
}

/** Opens a file with the system's default app (the browser, for .html). */
export function openFile(file: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}
