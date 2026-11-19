// Turns multicast-DNS answers into sightings for the tracker. Pure and bounded, so the Electron main process (sockets)
// and tests drive it identically. A host appears only once its PTR, SRV, TXT and an address have all arrived; follow-up
// questions are returned for whatever is missing rather than guessed.
import { DISCOVERY_DOMAIN, DISCOVERY_SERVICE, parseAdvert, type Endpoint } from './contract'
import { TYPE, sameName, type MdnsMessage } from './mdns'
import type { Sighting } from './tracker'

export const SERVICE_NAME = `${DISCOVERY_SERVICE}.${DISCOVERY_DOMAIN}`
const MAX_INSTANCES = 100

interface Instance {
  srv?: { port: number; target: string; ttl: number }
  txt?: { entries: string[]; ttl: number }
}

export interface BrowseUpdate {
  sightings: Sighting[]
  /** Sighting keys that were withdrawn by a goodbye. */
  lost: string[]
  /** Questions to send next for instances that are still incomplete. */
  followUps: { name: string; type: number }[]
}

export class DnsSdCollector {
  private instances = new Map<string, Instance>()
  private addresses = new Map<string, Map<string, number>>()
  private emitted = new Map<string, Set<string>>()

  private key(name: string) {
    return name.toLowerCase()
  }

  ingest(message: MdnsMessage, interfaceName?: string): BrowseUpdate {
    const lost: string[] = []
    if (!message.response) return { sightings: [], lost, followUps: [] }
    const suffix = `.${SERVICE_NAME}`.toLowerCase()
    const touched = new Set<string>()
    for (const record of message.records) {
      const name = record.name
      const lower = this.key(name)
      const { data } = record
      if (data.type === 'PTR') {
        if (!sameName(name, SERVICE_NAME) || !data.target.toLowerCase().endsWith(suffix)) continue
        const instance = this.key(data.target)
        if (record.ttl === 0) {
          for (const key of this.emitted.get(instance) ?? []) lost.push(key)
          this.emitted.delete(instance)
          this.instances.delete(instance)
          continue
        }
        if (!this.instances.has(instance) && this.instances.size >= MAX_INSTANCES) continue
        this.instances.set(instance, this.instances.get(instance) ?? {})
        touched.add(instance)
      } else if (data.type === 'SRV' || data.type === 'TXT') {
        if (!lower.endsWith(suffix)) continue
        const known = this.instances.get(lower)
        if (!known && this.instances.size >= MAX_INSTANCES) continue
        const entry = known ?? {}
        if (data.type === 'SRV') entry.srv = { port: data.port, target: this.key(data.target), ttl: record.ttl }
        else entry.txt = { entries: data.entries, ttl: record.ttl }
        this.instances.set(lower, entry)
        touched.add(lower)
      } else if (data.type === 'A' || data.type === 'AAAA') {
        const set = this.addresses.get(lower) ?? new Map<string, number>()
        // A cache flush replaces the records of the same type only: A and AAAA are separate sets.
        if (record.flush)
          for (const known of [...set.keys()]) if (known.includes(':') === (data.type === 'AAAA')) set.delete(known)
        if (record.ttl === 0) set.delete(data.address)
        else set.set(data.address, record.ttl)
        if (set.size > 8) set.delete(set.keys().next().value!)
        if (this.addresses.size < 200 || this.addresses.has(lower)) this.addresses.set(lower, set)
        for (const [instance, value] of this.instances) if (value.srv?.target === lower) touched.add(instance)
      }
    }
    const sightings: Sighting[] = []
    const followUps: { name: string; type: number }[] = []
    for (const instanceName of touched) {
      const instance = this.instances.get(instanceName)
      if (!instance) continue
      if (!instance.srv || !instance.txt) {
        if (!instance.srv) followUps.push({ name: instanceName, type: TYPE.SRV })
        if (!instance.txt) followUps.push({ name: instanceName, type: TYPE.TXT })
        continue
      }
      const addresses = this.addresses.get(instance.srv.target)
      if (!addresses?.size) {
        followUps.push({ name: instance.srv.target, type: TYPE.A }, { name: instance.srv.target, type: TYPE.AAAA })
        continue
      }
      const parsed = parseAdvert(instance.txt.entries)
      if (!parsed.ok) continue
      const keys = this.emitted.get(instanceName) ?? new Set<string>()
      const ttlMs = Math.min(instance.srv.ttl, instance.txt.ttl) * 1000
      for (const address of addresses.keys()) {
        const endpoint: Endpoint = { address, port: instance.srv.port, scheme: parsed.advert.scheme }
        const key = `${instanceName}/${address}`
        keys.add(key)
        sightings.push({ key, advert: parsed.advert, endpoint, ttlMs, ...(interfaceName ? { interfaceName } : {}) })
      }
      this.emitted.set(instanceName, keys)
    }
    return { sightings, lost, followUps }
  }
}
