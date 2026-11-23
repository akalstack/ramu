import type { Cloudflare } from '../src/cloudflare'
import type { ListedTunnel, Slot, Store, Waiting } from '../src/pool'

export function memoryStore(): Store {
  const slots = new Map<string, Slot>()
  const waiting = new Map<string, Waiting>()
  const sessions = new Map<string, { userId: string; expiresAt: number }>()
  const down = new Map<string, number>()
  const meta = new Map<string, number>()
  return {
    slotOf: (userId, hostId) => slots.get(`${userId}/${hostId}`) ?? null,
    slotsOf: (userId) =>
      [...slots.values()].filter((slot) => slot.userId === userId).sort((a, b) => a.createdAt - b.createdAt),
    slots: () => [...slots.values()],
    putSlot: (slot) => void slots.set(`${slot.userId}/${slot.hostId}`, slot),
    deleteSlot: (userId, hostId) => void slots.delete(`${userId}/${hostId}`),
    waiting: () => [...waiting.values()].sort((a, b) => a.since - b.since),
    putWaiting: (entry) => void waiting.set(`${entry.userId}/${entry.hostId}`, entry),
    deleteWaiting: (userId, hostId) => void waiting.delete(`${userId}/${hostId}`),
    session: (hash, now) => {
      const entry = sessions.get(hash)
      return entry && entry.expiresAt > now ? entry.userId : null
    },
    putSession: (hash, userId, expiresAt) => void sessions.set(hash, { userId, expiresAt }),
    downSince: (id) => down.get(id) ?? null,
    setDownSince: (id, at) => void (at === null ? down.delete(id) : down.set(id, at)),
    meta: (key) => meta.get(key) ?? null,
    setMeta: (key, value) => void meta.set(key, value),
  }
}

export interface FakeCloudflare extends Cloudflare {
  tunnels: Map<string, { name: string; ingress: unknown[] }>
  records: Map<string, { name: string; target: string }>
  listed: ListedTunnel[]
  bytes: Map<string, number>
  calls: string[]
  fail: boolean
}

export function fakeCloudflare(): FakeCloudflare {
  let next = 0
  const fake: FakeCloudflare = {
    tunnels: new Map(),
    records: new Map(),
    listed: [],
    bytes: new Map(),
    calls: [],
    fail: false,
    async createTunnel(name) {
      if (fake.fail) throw new Error('Cloudflare is down')
      const id = `tunnel-${++next}`
      fake.tunnels.set(id, { name, ingress: [] })
      fake.calls.push(`create ${name}`)
      return id
    },
    async putIngress(id, ingress) {
      fake.tunnels.get(id)!.ingress = ingress
      fake.calls.push(`ingress ${id}`)
    },
    async tunnelToken(id) {
      return `token-for-${id}`
    },
    async deleteTunnel(id) {
      fake.tunnels.delete(id)
      fake.calls.push(`delete ${id}`)
    },
    async putCname(name, target, recordId) {
      const id = recordId ?? `record-${++next}`
      fake.records.set(id, { name, target })
      fake.calls.push(`cname ${name} -> ${target}`)
      return id
    },
    async deleteRecord(id) {
      fake.records.delete(id)
      fake.calls.push(`delete-record ${id}`)
    },
    async listTunnels() {
      // A deleted tunnel is no longer listed.
      return fake.listed.filter((tunnel) => !fake.calls.includes(`delete ${tunnel.id}`))
    },
    async bytesByHost() {
      return fake.bytes
    },
  }
  return fake
}
