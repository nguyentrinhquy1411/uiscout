export interface UsageEvent {
  /** Route with data IDs collapsed to ":id". */
  route: string
  /** data-scout-id or data-testid; empty for a page view. */
  id: string
  action: 'click' | 'fill' | 'submit' | 'view'
  count: number
}

export interface TrackOptions {
  /** Where batches go: sendBeacon to your endpoint, your analytics SDK, … */
  send: (batch: { events: UsageEvent[] }) => void
  /** Batch interval in ms (default 10 000), plus on page hide. */
  flushMs?: number
  /** Fraction of page loads that report (default 1). */
  sample?: number
}

/** Counts actions on controls with a data-scout-id or data-testid. Returns a stop function. */
export function trackUsage(options: TrackOptions): () => void

export function routeOf(pathname: string): string
