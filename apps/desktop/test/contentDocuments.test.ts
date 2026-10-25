import { expect, it } from 'vitest'
import { ContentDocuments } from '../src/main/contentDocuments'
it('serves only bounded mounted documents with their own restrictive response policy', async () => {
  const documents = new ContentDocuments()
  const url = documents.mount('<p>Saved</p>')
  expect(url).toMatch(/^ramu-content:\/\/[\w-]+\/document$/)
  const response = documents.response(url)
  expect(await response.text()).toBe('<p>Saved</p>')
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  const policy = response.headers.get('content-security-policy')!
  // Remote https libraries and data load; frames, plugins, forms and plain http do not.
  for (const directive of [
    'connect-src https:',
    'script-src',
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ])
    expect(policy).toContain(directive)
  expect(policy).not.toMatch(/http:(?!\/)|\*/)
  expect(documents.response(url + '?path=/etc/passwd').status).toBe(404)
  documents.release(url)
  expect(documents.response(url).status).toBe(404)
  expect(() => documents.mount('a'.repeat(2_000_001))).toThrow('Invalid')
  for (let n = 0; n < 4; n++) documents.mount('document')
  expect(() => documents.mount('fifth')).toThrow('Too many')
  documents.clear()
  expect(() => documents.mount('again')).not.toThrow()
})
