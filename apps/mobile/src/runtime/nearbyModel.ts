// Pure rules for nearby-host discovery on the phone: how a native sighting becomes a listed host, which pairing method
// is showing, and when the camera or the network browse may run. No React Native imports, so Node tests cover it.
import { parseAdvert } from '@ramu/shared/discovery/contract'
import type { Sighting } from '@ramu/shared/discovery/tracker'

/** The order the pairing screen offers its methods in: discovery first, QR second, typing last. */
export const PAIR_METHODS = ['nearby', 'qr', 'manual'] as const
export type PairMethod = (typeof PAIR_METHODS)[number]

/** One resolved service as the native module reports it. Every field is untrusted input. */
export interface NativeSighting {
  key: string
  /** `key=value` TXT strings. */
  txt: string[]
  address: string
  port: number
  interfaceName?: string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 120_000

/** A listed sighting, or null when the advertisement is malformed, from a newer protocol or has an unusable address. */
export function sightingFromNative(result: NativeSighting): Sighting | null {
  if (!result || typeof result.key !== 'string' || result.key.length > 300 || !Array.isArray(result.txt)) return null
  const parsed = parseAdvert(result.txt.filter((entry) => typeof entry === 'string'))
  if (!parsed.ok) return null
  if (typeof result.address !== 'string' || !Number.isInteger(result.port)) return null
  return {
    key: result.key,
    advert: parsed.advert,
    endpoint: { address: result.address, port: result.port, scheme: parsed.advert.scheme },
    ttlMs: Number.isFinite(result.ttlMs) ? result.ttlMs! : DEFAULT_TTL_MS,
    ...(result.interfaceName ? { interfaceName: result.interfaceName } : {}),
  }
}

/** The camera opens only for the QR method, and only while the app is in front. Opening the screen never starts it. */
export const cameraActive = (method: PairMethod, foreground: boolean) => method === 'qr' && foreground

/** Browsing runs only for the nearby method while the app is in front; changing method or backgrounding stops it. */
export const browsingActive = (method: PairMethod, foreground: boolean) => method === 'nearby' && foreground

/** Web has no native browse or camera, so manual entry is the only method there. */
export const availableMethods = (native: boolean): PairMethod[] => (native ? [...PAIR_METHODS] : ['manual'])

/** The method a person lands on: discovery first on a phone. A link or QR already carrying an address goes straight to review. */
export function initialMethod(native: boolean, hasOffer: boolean): PairMethod {
  return hasOffer || !native ? 'manual' : 'nearby'
}

/** What a chosen host fills in. Only an address and a name: the pairing code always comes from the host. */
export function pairingFill(
  host: { name: string; routes: { url: string }[] },
  url: string,
): { address: string; name: string } | null {
  return host.routes.some((route) => route.url === url) ? { address: url, name: host.name } : null
}
