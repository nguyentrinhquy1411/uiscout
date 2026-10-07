import type { Page, Request } from 'playwright'
import { NO_RECORDING } from '../network.ts'
import type { Finding } from '../types.ts'

/*
 * Oracle A, script errors and network (design doc §7A). Listens to one page for
 * its whole life and charges everything to whichever step is current, so a 500
 * reads as "clicking Save on /docs called POST /api/x, which returned 500".
 */

export interface MonitorOptions {
  /** 4xx responses that are expected, as "METHOD /path" prefixes or bare status codes ("404"). */
  allow4xx?: string[]
  /** console.error text to ignore (substring match), e.g. a known third-party warning. */
  ignoreConsole?: string[]
}

export class StepMonitor {
  findings: Finding[] = []
  /** Requests made during the current step, for the edge's api list. */
  api: string[] = []
  /** The last top-level navigation, to name an external destination the browser couldn't load. */
  lastNavigation = ''
  private at = ''
  private inflight = new Set<Request>()
  private readonly origin: string
  private readonly options: MonitorOptions

  constructor(page: Page, origin: string, options: MonitorOptions = {}) {
    this.origin = origin
    this.options = options
    page.on('pageerror', (err) => this.add('script', 'error', `Uncaught ${err.name}: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      // Failed resources already surface as network findings, with more detail.
      if (/^Failed to load resource/.test(text)) return
      if (this.options.ignoreConsole?.some((s) => text.includes(s))) return
      this.add('script', 'error', `console.error: ${consoleSummary(text)}`)
    })
    page.on('request', (req) => {
      this.inflight.add(req)
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) this.lastNavigation = req.url()
      if (this.isApp(req)) this.api.push(`${req.method()} ${this.pathOf(req)}`)
    })
    page.on('requestfinished', (req) => this.inflight.delete(req))
    page.on('requestfailed', (req) => {
      this.inflight.delete(req)
      const reason = req.failure()?.errorText ?? 'failed'
      // Navigation and unmount cancel requests on purpose; --block aborts them by request.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(reason)) return
      if (this.isApp(req)) this.add('network', 'error', `${req.method()} ${this.pathOf(req)} failed: ${reason}`)
    })
    page.on('response', (res) => {
      const status = res.status()
      if (status < 400 || !this.isApp(res.request())) return
      const call = `${res.request().method()} ${this.pathOf(res.request())}`
      // Replay had nothing to serve: the recordings are stale or never covered this step.
      if (res.headers()[NO_RECORDING]) return this.add('network', 'warning', `${call} has no recording (re-record with --mode record)`)
      if (status >= 500) this.add('network', 'error', `${call} returned ${status}`)
      else if (!this.allowed(call, status)) this.add('network', 'error', `${call} returned ${status}`)
    })
  }

  /** Start charging findings and requests to a new step. */
  begin(at: string): void {
    this.at = at
    this.api = []
  }

  get pending(): number {
    return this.inflight.size
  }

  private add(oracle: Finding['oracle'], severity: Finding['severity'], message: string): void {
    // One finding per message per step: a render loop logging the same error 50 times is one defect.
    if (this.findings.some((f) => f.at === this.at && f.message === message)) return
    this.findings.push({ oracle, severity, at: this.at, message })
  }

  private isApp(req: Request): boolean {
    const type = req.resourceType()
    return req.url().startsWith(this.origin) && (type === 'fetch' || type === 'xhr' || type === 'document' || type === 'eventsource')
  }

  private pathOf(req: Request): string {
    const url = new URL(req.url())
    return url.pathname
  }

  private allowed(call: string, status: number): boolean {
    return (this.options.allow4xx ?? []).some((rule) => rule === String(status) || call.startsWith(rule))
  }
}

/**
 * React logs errors as a format string ("%o\n\n%s") followed by the stack; keep
 * the one line that says what went wrong.
 */
export function consoleSummary(text: string): string {
  const lines = text.replace(/%[osdifcO]/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('at '))
  const line = lines.find((l) => /\b(Error|Warning|TypeError|ReferenceError)\b/.test(l)) ?? lines[0] ?? text
  return line.slice(0, 240)
}
