/** What the address box makes of typed text: a full address, or a bare host such as localhost:3000 or example.com. */
export function addressFrom(raw: string): string | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  // localhost and private-looking hosts are local development servers; everything else is a website.
  return `${/^(localhost|127\.|\[::1\])/i.test(text) ? 'http' : 'https'}://${text}`
}
