import { describe, expect, it } from 'vitest'
import { redactBody, redactForm, redactJson, redactText } from '../src/redact.ts'
import { fingerprintOf } from '../src/identity.ts'

describe('redaction', () => {
  it('hides emails and tokens in text', () => {
    expect(redactText('Signed in as ann@example.com')).toBe('Signed in as [email]')
    expect(redactText('Bearer abc.def-ghi')).toBe('[token]')
    expect(redactText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_part-1')).toBe('[token]')
    expect(redactText('Save version')).toBe('Save version')
  })

  it('hides sensitive keys in JSON, keeping the shape', () => {
    expect(redactJson({ user: { name: 'Ann', email: 'ann@x.io', password: 'hunter2' }, items: [{ id: 1, token: 'abc' }] }))
      .toEqual({ user: { name: 'Ann', email: '[redacted]', password: '[redacted]' }, items: [{ id: 1, token: '[redacted]' }] })
  })

  it('hides everything under a sensitive key, objects and arrays included', () => {
    expect(redactJson({ address: { street: '1 Main St', city: 'Hue' }, phones: ['0901'], phone: ['0902'] }))
      .toEqual({ address: '[redacted]', phones: '[redacted]', phone: '[redacted]' })
  })

  it('redacts forms, and JSON whatever the content type says', () => {
    expect(redactForm('user=ann%40x.io&password=hunter2&q=hi')).toBe('user=%5Bemail%5D&password=%5Bredacted%5D&q=hi')
    expect(redactBody(Buffer.from('{"token":"t"}'), '').toString()).toBe('{"token":"[redacted]"}')
    expect(redactBody(Buffer.from('{"token":"t"}'), 'text/plain').toString()).toBe('{"token":"[redacted]"}')
  })

  it('redacts a JSON body and leaves binary alone', () => {
    expect(redactBody(Buffer.from('{"sessionId":"s1","n":2}'), 'application/json').toString()).toBe('{"sessionId":"[redacted]","n":2}')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    expect(redactBody(png, 'image/png')).toBe(png)
  })

  it('never puts a visible email into a fingerprint (and so into the graph or a snapshot)', () => {
    const fp = fingerprintOf({ i: 0, tag: 'button', role: 'button', name: 'ann@example.com', testId: null, parents: 'nav', href: null, target: null, disabled: false, submit: null, source: null, box: { x: 0, y: 0, w: 10, h: 10 } })
    expect(fp.name).toBe('[email]')
  })
})
