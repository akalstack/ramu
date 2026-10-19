import { expect, it } from 'vitest'
import { ContentDocuments } from '../src/main/contentDocuments'
it('serves only bounded mounted documents with their own restrictive response policy', async () => {
  const documents = new ContentDocuments()
  const url = documents.mount('<p>Saved</p>')
  expect(url).toMatch(/^ramu-content:\/\/[\w-]+\/document$/)
  const response = documents.response(url)
  expect(await response.text()).toBe('<p>Saved</p>')
  expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  expect(response.headers.get('content-security-policy')).toContain("connect-src 'none'")
  expect(documents.response(url + '?path=/etc/passwd').status).toBe(404)
  documents.release(url)
  expect(documents.response(url).status).toBe(404)
  expect(() => documents.mount('a'.repeat(800_001))).toThrow('Invalid')
  for (let n = 0; n < 4; n++) documents.mount('document')
  expect(() => documents.mount('fifth')).toThrow('Too many')
  documents.clear()
  expect(() => documents.mount('again')).not.toThrow()
})
