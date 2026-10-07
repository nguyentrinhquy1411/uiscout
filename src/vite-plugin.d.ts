import type { SourceMap } from 'magic-string'

export interface FlowcheckIdsOptions {
  /** Files to stamp (default: .jsx/.tsx under a src/ directory). */
  include?: RegExp
  /** Paths in data-fc-src are relative to this (default: the Vite root). */
  root?: string
}

/** Vite plugin: stamps interactive JSX with data-fc-src and data-fc-id. Use in test builds. */
export function flowcheckIds(options?: FlowcheckIdsOptions): {
  name: string
  enforce: 'pre'
  configResolved(config: { root: string }): void
  transform(code: string, id: string): { code: string; map: SourceMap } | null
}

export function stampIds(code: string, relPath: string, file?: string): { code: string; map: SourceMap } | null
