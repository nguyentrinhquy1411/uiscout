import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { BrowserContext, Request, Route } from 'playwright'

/*
 * Network modes (design doc §6). `record` walks against a real backend and keeps
 * every API response; `replay` serves them back with no backend at all, which
 * makes runs fast and repeatable and lets destructive controls be walked: nothing
 * they send reaches a server.
 *
 *   flowcheck/recordings.json   { "GET /api/items?page=1": [ { status, contentType, body, bodyHash? } ] }
 */

export type NetworkMode = 'live' | 'record' | 'replay'

export interface Recorded {
  status: number
  contentType: string
  /** Response body, base64. */
  body: string
  /** sha1 of the request body, to tell apart two POSTs to the same path. */
  requestHash?: string
}

export type Recordings = Record<string, Recorded[]>

/** Header the replay sets on a request it has no recording for; the monitor reports it. */
export const NO_RECORDING = 'x-flowcheck-no-recording'

export function requestKey(req: Request): string {
  const url = new URL(req.url())
  const query = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&')
  return `${req.method()} ${url.pathname}${query ? `?${query}` : ''}`
}

const hashOf = (req: Request) => {
  const body = req.postDataBuffer()
  return body?.length ? createHash('sha1').update(body).digest('hex').slice(0, 12) : undefined
}

/**
 * What the modes intercept: same-origin API calls, and any non-GET navigation
 * (a plain form POST), so a replayed "Delete" can't reach the server either way.
 */
function intercepted(req: Request, origin: string): boolean {
  if (!req.url().startsWith(origin)) return false
  const type = req.resourceType()
  return type === 'fetch' || type === 'xhr' || (type === 'document' && req.method() !== 'GET')
}

export async function loadRecordings(file: string): Promise<Recordings> {
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Recordings) : {}
}

export async function saveRecordings(file: string, recordings: Recordings): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Installs the mode's route handler on a browser context. `live` installs nothing. */
export async function installNetworkMode(context: BrowserContext, mode: NetworkMode, origin: string, recordings: Recordings): Promise<void> {
  if (mode === 'live') return
  await context.route(
    (url) => url.origin === origin,
    async (route: Route) => {
      const req = route.request()
      if (!intercepted(req, origin)) return route.fallback()
      const key = requestKey(req)
      if (mode === 'record') {
        const response = await route.fetch()
        const body = await response.body()
        const entry: Recorded = { status: response.status(), contentType: response.headers()['content-type'] ?? '', body: body.toString('base64') }
        const hash = hashOf(req)
        if (hash) entry.requestHash = hash
        const list = (recordings[key] ??= [])
        // One recording per distinct request body; the latest response wins.
        const same = list.findIndex((r) => r.requestHash === entry.requestHash)
        if (same >= 0) list[same] = entry
        else list.push(entry)
        return route.fulfill({ response, body })
      }
      const list = recordings[key] ?? []
      const hash = hashOf(req)
      // Exact body first; a single recording for the path stands in for any body
      // (request bodies often carry timestamps that never match twice).
      const hit = list.find((r) => r.requestHash === hash) ?? (list.length === 1 ? list[0] : undefined)
      if (!hit) return route.fulfill({ status: 599, headers: { [NO_RECORDING]: '1' }, body: '' })
      return route.fulfill({ status: hit.status, contentType: hit.contentType, body: Buffer.from(hit.body, 'base64') })
    },
  )
}
