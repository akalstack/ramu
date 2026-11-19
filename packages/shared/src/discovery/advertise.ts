// What a host publishes and when it answers. Pure: the server's advertiser owns the sockets, interface selection and
// lifecycle, and feeds these functions decoded packets.
import {
  DISCOVERY_DOMAIN,
  cleanDiscoveryName,
  encodeAdvert,
  parseAdvert,
  usableAddress,
  type DiscoveryAdvert,
} from './contract'
import { TYPE, sameName, type MdnsMessage, type MdnsRecord } from './mdns'
import { SERVICE_NAME } from './browse'

/** DNS labels hold a name's dots poorly in this codec; a dot is shown as a dash. */
export const instanceLabel = (name: string, suffix = 0) => {
  const base = cleanDiscoveryName(name).replace(/\./g, '-') || 'Ramu host'
  return suffix > 0 ? `${base.slice(0, 40)} (${suffix + 1})` : base
}

export interface Publication {
  /** Unique instance label under the service type. Changes when another host already uses it. */
  label: string
  advert: DiscoveryAdvert
  port: number
  /** Addresses of the network interface being advertised on only: never loopback, never another network. */
  addresses: string[]
}

export const instanceName = (label: string) => `${label}.${SERVICE_NAME}`
export const hostName = (advert: DiscoveryAdvert) => `ramu-${advert.hostId.slice(0, 12)}.${DISCOVERY_DOMAIN}`

/** The four record sets of one advertisement. `ttl` 0 produces the matching goodbye. */
export function publicationRecords(publication: Publication, ttl: number): MdnsRecord[] {
  const instance = instanceName(publication.label)
  const host = hostName(publication.advert)
  const addresses = publication.addresses.filter(usableAddress)
  return [
    { name: SERVICE_NAME, ttl, data: { type: 'PTR', target: instance } },
    { name: instance, ttl, flush: true, data: { type: 'SRV', port: publication.port, target: host } },
    { name: instance, ttl, flush: true, data: { type: 'TXT', entries: encodeAdvert(publication.advert) } },
    ...addresses.map((address): MdnsRecord => ({
      name: host,
      ttl,
      flush: true,
      data: { type: address.includes(':') ? 'AAAA' : 'A', address },
    })),
  ]
}

/** Whether a received query asks for this publication, so it is answered once per question, not once per packet. */
export function asks(message: MdnsMessage, publication: Publication): boolean {
  if (message.response) return false
  const instance = instanceName(publication.label)
  const host = hostName(publication.advert)
  return message.questions.some(
    (question) =>
      (sameName(question.name, SERVICE_NAME) && (question.type === TYPE.PTR || question.type === 255)) ||
      (sameName(question.name, instance) && [TYPE.SRV, TYPE.TXT, 255].includes(question.type)) ||
      (sameName(question.name, host) && [TYPE.A, TYPE.AAAA, 255].includes(question.type)),
  )
}

/** Another host publishing under our instance name. The later one renames. */
export function conflictsWith(message: MdnsMessage, publication: Publication): boolean {
  if (!message.response) return false
  const instance = instanceName(publication.label)
  const txt = message.records.find(
    (record) => sameName(record.name, instance) && record.data.type === 'TXT' && record.ttl > 0,
  )
  if (!txt || txt.data.type !== 'TXT') return false
  const parsed = parseAdvert(txt.data.entries)
  // An unreadable TXT under our name is also somebody else's.
  return !parsed.ok || parsed.advert.hostId !== publication.advert.hostId
}
