// Pairing a phone or another computer with this host: what its QR code says, the network it needs, and which of its
// addresses to offer. Pure, so the setup step and the Pair dialog agree and tests can check them.
import { encodePairWebLink } from '@ramu/contracts'
import type { NetworkSettingsInput, NetworkStatus, PairingOffer } from '@ramu/shared/types'
import { VIRTUAL_INTERFACE } from '@ramu/shared/networkLabel'

const LOOPBACK = /^(127\.|::1$|localhost$)/

/**
 * What a pairing QR code holds: a getramu.dev link any phone camera opens. It opens Ramu with the code filled in, or
 * the App Store or Google Play first; the address and code stay after `#`, so the site never receives them.
 */
export function pairQrText(offer: Pick<PairingOffer, 'code' | 'expiresAt'>, url: string, name?: string): string {
  return encodePairWebLink({ url, code: offer.code, expiresAt: offer.expiresAt, ...(name ? { name } : {}) })
}

/**
 * The network change a phone needs before it can pair: devices allowed beyond this computer, and the host visible to
 * nearby devices. Null when nothing needs changing, or when the command line set the network.
 */
export function pairingNetwork(status: NetworkStatus): NetworkSettingsInput | null {
  if (status.source === 'command-line') return null
  const network = status.enabled && !LOOPBACK.test(status.host)
  const discoverable = !status.discovery || status.discovery.discoverable
  if (network && discoverable) return null
  return {
    enabled: true,
    host: LOOPBACK.test(status.host) ? '0.0.0.0' : status.host,
    port: status.port,
    acceptUnencrypted: true,
    ...(status.discovery ? { discoverable: true } : {}),
  }
}

/** A host's addresses for pairing, IPv4 first (shorter, and what people type); Docker, VM and VPN bridges last. */
export function pairingUrls(urls: PairingOffer['urls']): { likely: PairingOffer['urls']; other: PairingOffer['urls'] } {
  const sorted = [...urls].sort((a, b) => Number(a.url.includes('[')) - Number(b.url.includes('[')))
  return {
    likely: sorted.filter((entry) => !VIRTUAL_INTERFACE.test(entry.interface)),
    other: sorted.filter((entry) => VIRTUAL_INTERFACE.test(entry.interface)),
  }
}

/** The address a QR code offers unless the person picks another: the first likely one, or any. */
export const defaultPairUrl = (urls: PairingOffer['urls']): string | undefined => {
  const { likely, other } = pairingUrls(urls)
  return (likely[0] ?? other[0])?.url
}

/** `m:ss` left until a pairing code expires. */
export const countdown = (expiresAt: number, now: number) => {
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}
