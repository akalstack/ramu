interface TerminalBuffer { data: string; truncated: boolean }
/** Agent transcripts are fetched on resume. Only bounded terminal output and latest state are kept here. */
export class HiddenEvents {
  private readonly terminals = new Map<string, TerminalBuffer>()
  private readonly latest = new Map<string, { channel: string; payload: any }>()
  private size = 0
  constructor(private readonly maxChars = 1024 * 1024, private readonly perTerminal = 128 * 1024) {}
  add(channel: string, payload: any) {
    if (channel === 'term:data') {
      const entry = this.terminals.get(payload.id) ?? { data: '', truncated: false }
      this.size -= entry.data.length
      entry.data += payload.data
      if (entry.data.length > this.perTerminal) { entry.data = entry.data.slice(-this.perTerminal); entry.truncated = true }
      this.size += entry.data.length; this.terminals.set(payload.id, entry)
      while (this.terminals.size > 128) { const id = this.terminals.keys().next().value!; this.size -= this.terminals.get(id)!.data.length; this.terminals.delete(id) }
      while (this.size > this.maxChars) {
        const first = [...this.terminals.values()].find((buffer) => buffer.data.length)!
        const remove = Math.min(first.data.length, this.size - this.maxChars)
        first.data = first.data.slice(remove); first.truncated = true; this.size -= remove
        if (!remove) break
      }
      return
    }
    if (['agent:event', 'fs:changed', 'context:changed', 'aside:changed', 'background:connection', 'computers:changed'].includes(channel)) return
    const key = channel === 'term:exit' ? `${channel}:${payload.id}` : channel
    this.latest.set(key, { channel, payload })
    if (this.latest.size > 128) this.latest.delete(this.latest.keys().next().value!)
  }
  drain(send: (channel: string, payload: unknown) => void, truncatedLabel: string) {
    for (const [id, entry] of this.terminals) send('term:data', { id, data: `${entry.truncated ? `\x1bc\x1b[2m[${truncatedLabel}]\x1b[0m\r\n` : ''}${entry.data}` })
    for (const { channel, payload } of this.latest.values()) send(channel, payload)
    this.terminals.clear(); this.latest.clear(); this.size = 0
  }
}
