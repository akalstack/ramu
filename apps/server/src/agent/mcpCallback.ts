const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Where a provider waits for a sign-in page to return on the host itself: the `redirect_uri` of its authorization
 * address, when that is a loopback address. Undefined for any other return address.
 */
export function loopbackRedirect(authUrl: string): URL | undefined {
  try {
    const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') ?? '')
    return redirect.protocol === 'http:' && LOOPBACK.has(redirect.hostname) ? redirect : undefined
  } catch {
    return undefined
  }
}

/**
 * Hands the address a sign-in page ended on, pasted from another device whose browser could not reach the host, to
 * the provider's listener on the host. Only the exact loopback address the sign-in named is ever requested, so a
 * pasted address cannot send the host anywhere else, and a redirect is not followed.
 */
export async function deliverLoopbackCallback(
  expected: URL,
  pasted: string,
  request: typeof fetch = fetch,
): Promise<void> {
  let url: URL
  try {
    url = new URL(pasted.trim())
  } catch {
    throw new Error('Paste the whole address your browser ended on, starting with http://localhost.')
  }
  if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname)
    throw new Error('That address belongs to a different sign-in. Paste the address this sign-in ended on.')
  if (!url.searchParams.has('code') && !url.searchParams.has('error'))
    throw new Error('That address has no sign-in code. Paste the whole address, including everything after "?".')
  let answer: Response
  try {
    answer = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('The sign-in is no longer waiting on the host. Start the sign-in again.')
  }
  if (answer.status >= 400) throw new Error(`The host's sign-in did not accept that address (${answer.status}).`)
}
