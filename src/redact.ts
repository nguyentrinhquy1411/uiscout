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

export const isSensitiveKey = (key: string) => SENSITIVE_KEY.test(key)

export function redactJson(value: unknown, key = ''): unknown {
  // The whole value under a sensitive key, objects and arrays included: "address": { street… }.
  if (key && SENSITIVE_KEY.test(key) && value !== null && value !== undefined) return '[redacted]'
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((v) => redactJson(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, k)]))
  return value
}

/** key=value&… with sensitive keys hidden and every value scrubbed. */
export function redactForm(text: string): string {
  const params = new URLSearchParams(text)
  for (const [k, v] of [...params]) params.set(k, SENSITIVE_KEY.test(k) ? '[redacted]' : redactText(v))
  return params.toString()
}

const BINARY = /^(image|audio|video|font)\/|octet-stream|zip|pdf|protobuf|wasm/

/**
 * A recorded response body, redacted. Whatever parses as JSON is treated as JSON,
 * whatever its content type claims (or doesn't); forms as forms; any other text
 * as text. Only bodies declared binary pass untouched.
 */
export function redactBody(body: Buffer, contentType: string): Buffer {
  if (BINARY.test(contentType)) return body
  const text = body.toString('utf8')
  try {
    return Buffer.from(JSON.stringify(redactJson(JSON.parse(text))))
  } catch {
    // Not JSON.
  }
  if (/x-www-form-urlencoded/.test(contentType)) return Buffer.from(redactForm(text))
  return Buffer.from(redactText(text))
}
