// A small multicast-DNS codec: just the records DNS-SD needs (PTR, SRV, TXT, A, AAAA). Decoding treats the packet as
// hostile: sizes, record counts, name lengths and compression loops are bounded, and anything odd is dropped.

export const MDNS_ADDRESS = '224.0.0.251'
export const MDNS_PORT = 5353

export const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 } as const
const CLASS_IN = 1
const CACHE_FLUSH = 0x8000

const MAX_PACKET = 9000
const MAX_RECORDS = 120
const MAX_NAME = 255

export type MdnsData =
  | { type: 'A' | 'AAAA'; address: string }
  | { type: 'PTR'; target: string }
  | { type: 'SRV'; port: number; target: string }
  | { type: 'TXT'; entries: string[] }

export interface MdnsRecord {
  name: string
  ttl: number
  /** Only unique records (SRV/TXT/A/AAAA) set it; it means older cached answers for the name are replaced. */
  flush?: boolean
  data: MdnsData
}

export interface MdnsQuestion {
  name: string
  type: number
  /** The unicast-response bit. Not used by Ramu, but decoded so it never reads as part of the class. */
  unicast: boolean
}

export interface MdnsMessage {
  response: boolean
  questions: MdnsQuestion[]
  records: MdnsRecord[]
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

class Writer {
  private bytes: number[] = []
  u8(value: number) {
    this.bytes.push(value & 0xff)
  }
  u16(value: number) {
    this.bytes.push((value >>> 8) & 0xff, value & 0xff)
  }
  u32(value: number) {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
  }
  raw(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.bytes.push(data[i]!)
  }
  name(name: string) {
    const labels = name.split('.').filter(Boolean)
    for (const label of labels) {
      const encoded = encoder.encode(label)
      if (encoded.length > 63) throw new Error('DNS label too long')
      this.u8(encoded.length)
      this.raw(encoded)
    }
    this.u8(0)
  }
  get length() {
    return this.bytes.length
  }
  patch16(at: number, value: number) {
    this.bytes[at] = (value >>> 8) & 0xff
    this.bytes[at + 1] = value & 0xff
  }
  done() {
    return Uint8Array.from(this.bytes)
  }
}

export function parseIPv4(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  const parts = match.slice(1).map(Number)
  return parts.every((part) => part <= 255) ? parts : null
}

export function parseIPv6(text: string): number[] | null {
  if (text.includes('%')) return null
  const halves = text.split('::')
  if (halves.length > 2) return null
  const side = (value: string) => (value ? value.split(':') : [])
  const head = side(halves[0]!)
  const tail = halves.length === 2 ? side(halves[1]!) : []
  const groups =
    halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null
  return groups.flatMap((group) => [parseInt(group, 16) >> 8, parseInt(group, 16) & 0xff])
}

const formatIPv6 = (bytes: Uint8Array) => {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16))
  return groups.join(':').replace(/(^|:)(0(:|$)){2,}/, '::')
}

function writeData(out: Writer, data: MdnsData) {
  switch (data.type) {
    case 'A': {
      const bytes = parseIPv4(data.address)
      if (!bytes) throw new Error('Invalid IPv4 address')
      out.raw(bytes)
      return
    }
    case 'AAAA': {
      const bytes = parseIPv6(data.address)
      if (!bytes) throw new Error('Invalid IPv6 address')
      out.raw(bytes)
      return
    }
    case 'PTR':
      out.name(data.target)
      return
    case 'SRV':
      out.u16(0)
      out.u16(0)
      out.u16(data.port)
      out.name(data.target)
      return
    case 'TXT': {
      const entries = data.entries.length ? data.entries : ['']
      for (const entry of entries) {
        const encoded = encoder.encode(entry)
        if (encoded.length > 255) throw new Error('TXT entry too long')
        out.u8(encoded.length)
        out.raw(encoded)
      }
      return
    }
  }
}

/** A response packet with the given records as answers. A TTL of 0 withdraws a record (goodbye). */
export function encodeResponse(records: MdnsRecord[]): Uint8Array {
  const out = new Writer()
  out.u16(0)
  out.u16(0x8400) // response, authoritative
  out.u16(0)
  out.u16(records.length)
  out.u16(0)
  out.u16(0)
  for (const record of records) {
    out.name(record.name)
    out.u16(TYPE[record.data.type])
    out.u16(CLASS_IN | (record.flush ? CACHE_FLUSH : 0))
    out.u32(record.ttl)
    const lengthAt = out.length
    out.u16(0)
    const start = out.length
    writeData(out, record.data)
    out.patch16(lengthAt, out.length - start)
  }
  return out.done()
}

/** A query packet for names/types, as a browser sends it. */
export function encodeQuery(questions: { name: string; type: number }[]): Uint8Array {
  const out = new Writer()
  out.u16(0)
  out.u16(0)
  out.u16(questions.length)
  out.u16(0)
  out.u16(0)
  out.u16(0)
  for (const question of questions) {
    out.name(question.name)
    out.u16(question.type)
    out.u16(CLASS_IN)
  }
  return out.done()
}

class Reader {
  private pos = 0
  constructor(private readonly view: DataView) {}
  get at() {
    return this.pos
  }
  seek(pos: number) {
    this.pos = pos
  }
  need(count: number) {
    if (this.pos + count > this.view.byteLength) throw new Error('Truncated packet')
  }
  u8() {
    this.need(1)
    return this.view.getUint8(this.pos++)
  }
  u16() {
    this.need(2)
    const value = this.view.getUint16(this.pos)
    this.pos += 2
    return value
  }
  u32() {
    this.need(4)
    const value = this.view.getUint32(this.pos)
    this.pos += 4
    return value
  }
  bytes(count: number) {
    this.need(count)
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, count)
    this.pos += count
    return value
  }
  name(): string {
    const labels: string[] = []
    let pos = this.pos
    let jumped = false
    let hops = 0
    let total = 0
    for (;;) {
      if (pos >= this.view.byteLength) throw new Error('Truncated name')
      const length = this.view.getUint8(pos)
      if ((length & 0xc0) === 0xc0) {
        if (pos + 1 >= this.view.byteLength) throw new Error('Truncated pointer')
        const target = ((length & 0x3f) << 8) | this.view.getUint8(pos + 1)
        if (!jumped) this.pos = pos + 2
        jumped = true
        // A pointer must point backwards and the chain is bounded: no loops.
        if (target >= pos || ++hops > 16) throw new Error('Bad name pointer')
        pos = target
        continue
      }
      if ((length & 0xc0) !== 0) throw new Error('Unsupported label')
      pos++
      if (length === 0) break
      total += length + 1
      if (total > MAX_NAME || pos + length > this.view.byteLength) throw new Error('Name too long')
      labels.push(decoder.decode(new Uint8Array(this.view.buffer, this.view.byteOffset + pos, length)))
      pos += length
    }
    if (!jumped) this.pos = pos
    return labels.join('.')
  }
}

function readData(reader: Reader, type: number, length: number, end: number): MdnsData | null {
  switch (type) {
    case TYPE.A: {
      if (length !== 4) return null
      return { type: 'A', address: [...reader.bytes(4)].join('.') }
    }
    case TYPE.AAAA: {
      if (length !== 16) return null
      return { type: 'AAAA', address: formatIPv6(reader.bytes(16)) }
    }
    case TYPE.PTR:
      return { type: 'PTR', target: reader.name() }
    case TYPE.SRV: {
      if (length < 7) return null
      reader.u16()
      reader.u16()
      const port = reader.u16()
      return { type: 'SRV', port, target: reader.name() }
    }
    case TYPE.TXT: {
      const entries: string[] = []
      while (reader.at < end) {
        const size = reader.u8()
        if (reader.at + size > end) return null
        entries.push(decoder.decode(reader.bytes(size)))
        if (entries.length > 64) return null
      }
      return { type: 'TXT', entries }
    }
    default:
      return null
  }
}

/** Decodes one datagram. Returns null for anything malformed or oversized; unknown record types are skipped. */
export function decodeMessage(packet: Uint8Array): MdnsMessage | null {
  if (packet.length < 12 || packet.length > MAX_PACKET) return null
  try {
    const reader = new Reader(new DataView(packet.buffer, packet.byteOffset, packet.byteLength))
    reader.u16()
    const flags = reader.u16()
    const questionCount = reader.u16()
    const counts = reader.u16() + reader.u16() + reader.u16()
    if (questionCount > MAX_RECORDS || counts > MAX_RECORDS) return null
    const questions: MdnsQuestion[] = []
    for (let i = 0; i < questionCount; i++) {
      const name = reader.name()
      const type = reader.u16()
      const klass = reader.u16()
      questions.push({ name, type, unicast: (klass & CACHE_FLUSH) !== 0 })
    }
    const records: MdnsRecord[] = []
    for (let i = 0; i < counts; i++) {
      const name = reader.name()
      const type = reader.u16()
      const klass = reader.u16()
      const ttl = reader.u32()
      const length = reader.u16()
      reader.need(length)
      const start = reader.at
      const end = start + length
      const data = readData(reader, type, length, end)
      reader.seek(end)
      if (data && (klass & 0x7fff) === CLASS_IN)
        records.push({ name, ttl, ...(klass & CACHE_FLUSH ? { flush: true } : {}), data })
    }
    return { response: (flags & 0x8000) !== 0, questions, records }
  } catch {
    return null
  }
}

/** DNS names compare case-insensitively. */
export const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
