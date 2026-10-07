/*
 * Everything flowcheck writes may be committed (design doc §14: recordings must be
 * kept free of personal data). Redaction runs before anything reaches disk:
 * response bodies in recordings, and the visible names in graphs and snapshots
 * (an account email in a sidebar would otherwise land in git).
 */

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
/** A JWT, a bearer header value, or a long hex/base64 run that looks like a secret. */
const TOKEN = /\beyJ[\w-]+\.[\w-]+\.[\w-]+|\bBearer\s+[\w.~+/-]+=*|\b[a-f0-9]{32,}\b|\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}/g
const SENSITIVE_KEY = /pass(word)?|secret|token|auth|cookie|session|api[_-]?key|credential|ssn|card|cvv|iban|phone|email|address/i

export function redactText(s: string): string {
  return s.replace(EMAIL, '[email]').replace(TOKEN, '[token]')
}

export function redactJson(value: unknown, key = ''): unknown {
  if (key && SENSITIVE_KEY.test(key) && value !== null && typeof value !== 'object') return '[redacted]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((v) => redactJson(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, k)]))
  return value
}

/** A recorded response body, redacted according to its type. Binary bodies pass untouched. */
export function redactBody(body: Buffer, contentType: string): Buffer {
  if (/json/.test(contentType)) {
    try {
      return Buffer.from(JSON.stringify(redactJson(JSON.parse(body.toString('utf8')))))
    } catch {
      return Buffer.from(redactText(body.toString('utf8')))
    }
  }
  if (/^text\/|xml|javascript|html/.test(contentType)) return Buffer.from(redactText(body.toString('utf8')))
  return body
}
