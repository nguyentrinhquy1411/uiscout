import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { BrowserContext, Request, Route } from 'playwright'
import { isSensitiveKey, redactBody, redactText } from './redact.ts'

/*
 * Network modes (design doc §6). `record` walks against a real backend and keeps
 * every API response; `replay` serves them back with no backend at all, which
 * makes runs fast and repeatable and lets destructive controls be walked.
 *
 * Replay fails closed: only the app's own page and static assets load. Every API
 * call (fetch, XHR, EventSource, beacons), every non-GET submission, every
 * navigation to another origin and every cross-origin WebSocket is answered from
 * the recordings or stopped — whichever origin it targets. Residual risk: an app
 * whose server also executes same-origin GET navigations (server-rendered "GET
 * /logout") still receives those.
 *
 *   flowcheck/recordings.json   { "GET /api/items?page=1": [ { status, contentType, body, requestHash? } ] }
 *
 * Recorded bodies are redacted (emails, tokens, sensitive JSON keys) before they
 * are kept: the file is meant to be committed.
 */

export type NetworkMode = 'live' | 'record' | 'replay'

export interface Recorded {
  status: number
  contentType: string
  /** Response body, base64, redacted. */
  body: string
  /** sha1 of the request body, to tell apart two POSTs to the same path. */
  requestHash?: string
}

export type Recordings = Record<string, Recorded[]>

/** Header the replay sets on a request it has no recording for; the monitor reports it. */
export const NO_RECORDING = 'x-flowcheck-no-recording'

const API_TYPES = new Set(['fetch', 'xhr', 'eventsource', 'ping'])
const STATIC_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'texttrack'])

/**
 * Same-origin calls keep a short key; calls to another origin include it. The key
 * is written to disk, so query values are redacted here — and replay builds the
 * same redacted key, so matching still works.
 */
export function requestKey(req: Request, origin: string): string {
  const url = new URL(req.url())
  const query = [...url.searchParams]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${isSensitiveKey(k) ? '[redacted]' : redactText(v)}`)
    .join('&')
  const where = url.origin === origin ? url.pathname : `${url.origin}${url.pathname}`
  return `${req.method()} ${where}${query ? `?${query}` : ''}`
}

const hashOf = (req: Request) => {
  const body = req.postDataBuffer()
  return body?.length ? createHash('sha1').update(body).digest('hex').slice(0, 12) : undefined
}

/** A call the modes record and replay: any API request, and any non-GET submission. */
const isCall = (req: Request) => API_TYPES.has(req.resourceType()) || (req.resourceType() === 'document' && req.method() !== 'GET')

export async function loadRecordings(file: string): Promise<Recordings> {
  return existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as Recordings) : {}
}

export async function saveRecordings(file: string, recordings: Recordings): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Installs the mode's handlers on a browser context. `live` installs nothing. */
export async function installNetworkMode(context: BrowserContext, mode: NetworkMode, origin: string, recordings: Recordings): Promise<void> {
  if (mode === 'live') return

  if (mode === 'record') {
    await context.route('**/*', async (route: Route) => {
      const req = route.request()
      if (!isCall(req)) return route.fallback()
      const response = await route.fetch()
      const body = await response.body()
      const contentType = response.headers()['content-type'] ?? ''
      const entry: Recorded = { status: response.status(), contentType, body: redactBody(body, contentType).toString('base64') }
      const hash = hashOf(req)
      if (hash) entry.requestHash = hash
      const list = (recordings[requestKey(req, origin)] ??= [])
      // One recording per distinct request body; the latest response wins.
      const same = list.findIndex((r) => r.requestHash === entry.requestHash)
      if (same >= 0) list[same] = entry
      else list.push(entry)
      // The page gets the real, unredacted response; only the file is redacted.
      return route.fulfill({ response, body })
    })
    return
  }

  await context.route('**/*', async (route: Route) => {
    const req = route.request()
    const sameOrigin = req.url().startsWith(origin)
    const type = req.resourceType()
    if (isCall(req)) {
      const list = recordings[requestKey(req, origin)] ?? []
      const hash = hashOf(req)
      // Exact body first; a single recording for the path stands in for any body
      // (request bodies often carry timestamps that never match twice).
      const hit = list.find((r) => r.requestHash === hash) ?? (list.length === 1 ? list[0] : undefined)
      if (!hit) return route.fulfill({ status: 599, headers: { [NO_RECORDING]: '1' }, body: '' })
      return route.fulfill({ status: hit.status, contentType: hit.contentType, body: Buffer.from(hit.body, 'base64') })
    }
    if (type === 'document' && !sameOrigin) {
      // Leaving the app: stand in for the other site so the edge is still recorded.
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>external (flowcheck replay)</title>' })
    }
    if (sameOrigin || (req.method() === 'GET' && STATIC_TYPES.has(type))) return route.fallback()
    return route.abort('blockedbyclient')
  })
  // Same-origin sockets are the dev server (hot reload); anything else could be a backend.
  await context.routeWebSocket(
    (url) => !url.href.replace(/^ws/, 'http').startsWith(origin),
    (ws) => ws.close({ code: 1008, reason: 'flowcheck replay: no backend' }),
  )
}
