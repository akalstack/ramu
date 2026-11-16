// Comment authors' and the Ramu account's pictures, fetched by the host so a device never loads them from the service
// itself (the desktop window allows only its own images, and a picture loaded by a device tells the service who is
// reading).

/** The hosts the services serve avatars from; any other address shows the author's initials instead. */
const AVATAR_HOSTS = [
  /^avatars\.githubusercontent\.com$/,
  /^(secure\.)?gravatar\.com$/,
  /^gitlab\.com$/,
  /^[\w-]+\.gitlab-static\.net$/,
  /^bitbucket\.org$/,
  /^avatar-management--avatars\.[\w-]+\.prod\.public\.atl-paas\.net$/,
  /^secure\.gravatar\.com$/,
  // Google account pictures, which a Ramu account made with Google carries.
  /^lh\d+\.googleusercontent\.com$/,
]
const MAX_BYTES = 256 * 1024
const KEPT = 300

const cache = new Map<string, Promise<string | null>>()

/** Whether the host may fetch this address as an avatar. */
export function avatarAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && AVATAR_HOSTS.some((host) => host.test(parsed.hostname))
  } catch {
    return false
  }
}

/** The picture as a data URL, or null when it is not an image, too large or not on a known avatar host. */
export function avatarDataUrl(url: string, get: typeof fetch = fetch): Promise<string | null> {
  if (!avatarAllowed(url)) return Promise.resolve(null)
  const known = cache.get(url)
  if (known) return known
  const reading = (async () => {
    const response = await get(url, { redirect: 'follow', signal: AbortSignal.timeout(8000) })
    // A redirect may only land on another known avatar host.
    if (!response.ok || !avatarAllowed(response.url || url)) return null
    const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_BYTES) return null
    return `data:${type};base64,${bytes.toString('base64')}`
  })().catch(() => null)
  cache.set(url, reading)
  // The oldest pictures go first once the cache is full.
  if (cache.size > KEPT) cache.delete(cache.keys().next().value!)
  return reading
}
