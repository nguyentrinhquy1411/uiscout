import type { Fingerprint, RawElement, Safety } from './types.ts'

/*
 * Identity without a build plugin (design doc §4): an element is known by its
 * fingerprint, and found again by weighted similarity (the Similo approach), so
 * a step still finds "Save" after the page re-rendered or moved it a little.
 */

const VIEWPORT = { w: 1280, h: 800 }

export function fingerprintOf(el: RawElement): Fingerprint {
  const cx = el.box.x + el.box.w / 2
  const cy = el.box.y + el.box.h / 2
  const col = Math.min(3, Math.max(0, Math.floor((cx / VIEWPORT.w) * 4)))
  const row = Math.min(3, Math.max(0, Math.floor((cy / VIEWPORT.h) * 4)))
  return { tag: el.tag, role: el.role, name: el.name, testId: el.testId, parents: el.parents, cell: `${row}${col}` }
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

/**
 * A readable ID: "<node>.<role>:<name>", or the developer's test ID when there
 * is one. Never positional — positions change on every refactor.
 */
export function elementId(node: string, fp: Fingerprint): string {
  if (fp.testId) return fp.testId
  const name = slug(fp.name) || 'unnamed'
  const where = fp.parents ? `@${fp.parents.replaceAll('>', '.')}` : ''
  return `${node}.${fp.role}:${name}${where}`
}

const WEIGHTS = { testId: 3, name: 2, role: 1, tag: 0.5, parents: 1, cell: 0.5 }
const MAX_SCORE = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)

/** 0–1: how alike two fingerprints are. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  let s = 0
  // Both without a test ID agree as much as both with the same one.
  if (a.testId === b.testId) s += WEIGHTS.testId
  if (a.name === b.name) s += WEIGHTS.name
  else if (a.name && b.name && (a.name.includes(b.name) || b.name.includes(a.name))) s += WEIGHTS.name * 0.5
  if (a.role === b.role) s += WEIGHTS.role
  if (a.tag === b.tag) s += WEIGHTS.tag
  if (a.parents === b.parents) s += WEIGHTS.parents
  if (a.cell === b.cell) s += WEIGHTS.cell
  return s / MAX_SCORE
}

export const MATCH_THRESHOLD = 0.7

/**
 * The element on the page that best matches a fingerprint. `exact` means every
 * attribute agreed; anything less is a healed lookup and gets reported.
 */
export function locate(target: Fingerprint, candidates: RawElement[]): { el: RawElement; exact: boolean } | null {
  let best: RawElement | null = null
  let bestScore = 0
  for (const el of candidates) {
    const score = similarity(target, fingerprintOf(el))
    if (score > bestScore) {
      best = el
      bestScore = score
    }
  }
  if (!best || bestScore < MATCH_THRESHOLD) return null
  return { el: best, exact: bestScore === 1 }
}

const DESTRUCTIVE = /\b(delete|remove|erase|wipe|destroy|discard|clear|reset|sign ?out|log ?out|unsubscribe|pay|purchase|send)\b|xo[áa]|x[óo]a|đăng xuất/i
const MUTATING = /\b(save|create|add|new|import|upload|archive|restore|duplicate|move|rename|submit|apply|accept|confirm|publish|done|complete)\b|th[êe]m|l[ưu]u|t[ạa]o/i

/**
 * Whether the runner may click it (§5 Safety labels). Without recordings there is
 * no undo, so destructive controls are never walked.
 */
export function safetyOf(fp: Fingerprint): Safety {
  const text = `${fp.name} ${fp.testId ?? ''}`
  if (DESTRUCTIVE.test(text)) return 'destructive'
  if (MUTATING.test(text)) return 'mutating'
  return 'safe'
}

const DYNAMIC_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26}|(?=.*\d)[\w-]{16,})$/i

/**
 * A route with its data IDs replaced by ":id" — "/chat/3c94…" and "/chat/7797…" are
 * the same screen showing different data (state abstraction, §5).
 */
export function routeOf(pathname: string): string {
  return pathname.split('/').map((seg) => (DYNAMIC_SEGMENT.test(seg) ? ':id' : seg)).join('/')
}
