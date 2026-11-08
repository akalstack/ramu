// Live typing on one artifact's text from several editors at once: the host keeps the text as a Yjs document, and
// each editor keeps a copy, turns every change in its text box into Yjs inserts and deletes, and swaps only what is
// new with the host about once a second. Characters typed at once in the same line all stay, in an order every
// editor agrees on. Shared so the host, the desktop and the phone use the same document shape.
import * as Y from 'yjs'

const FIELD = 'text'

/** The changes that turn `from` into `to`, as one replaced span: enough for a text box's single edit at a time. */
export function applyTextChange(text: Y.Text, from: string, to: string): void {
  if (from === to) return
  let start = 0
  while (start < from.length && start < to.length && from[start] === to[start]) start++
  let end = 0
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  )
    end++
  const removed = from.length - start - end
  const inserted = to.slice(start, to.length - end)
  text.doc!.transact(() => {
    if (removed) text.delete(start, removed)
    if (inserted) text.insert(start, inserted)
  })
}

/** The host's answer to a sync: what the editor lacks, and the host's state once it took the editor's changes. */
export interface LiveTextReply {
  update: string
  stateVector: string
}

const encode = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const decode = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0))

/** The host's copy: starts from a version's text, takes editors' changes and hands each back what it lacks. */
export class LiveTextHost {
  private readonly doc = new Y.Doc()

  constructor(initial: string) {
    this.doc.getText(FIELD).insert(0, initial)
  }

  get text(): string {
    return this.doc.getText(FIELD).toString()
  }

  /** The whole document, for an editor joining. */
  state(): string {
    return encode(Y.encodeStateAsUpdate(this.doc))
  }

  /** Applies an editor's changes and returns what that editor lacks, with the host's state after them. */
  exchange(update: string | null, stateVector: string): LiveTextReply {
    if (update) Y.applyUpdate(this.doc, decode(update))
    return {
      update: encode(Y.encodeStateAsUpdate(this.doc, decode(stateVector))),
      stateVector: encode(Y.encodeStateVector(this.doc)),
    }
  }
}

/** An editor's copy: joined from the host's state, then synced with what it typed since. */
export class LiveTextEditor {
  private readonly doc = new Y.Doc()
  /** What the host had at the last sync, so whatever it lacks is sent again until it has it. */
  private host: Uint8Array

  constructor(state: string) {
    Y.applyUpdate(this.doc, decode(state))
    this.host = Y.encodeStateVector(this.doc)
  }

  get text(): string {
    return this.doc.getText(FIELD).toString()
  }

  /** Records the text box's new contents as changes to the shared text. */
  edit(next: string): void {
    applyTextChange(this.doc.getText(FIELD), this.text, next)
  }

  /** What to send the host: the changes it lacks, and the state this copy has. */
  outgoing(): { update: string | null; stateVector: string } {
    const update = Y.encodeStateAsUpdate(this.doc, this.host)
    // An update with nothing in it is two bytes: no structs and no deletions.
    return { update: update.length > 2 ? encode(update) : null, stateVector: encode(Y.encodeStateVector(this.doc)) }
  }

  /** Applies what the host sent back, and returns the merged text. */
  incoming(reply: LiveTextReply): string {
    Y.applyUpdate(this.doc, decode(reply.update))
    this.host = decode(reply.stateVector)
    return this.text
  }
}

/**
 * One sync of an editor's text box: records what was typed, swaps changes with the host, records what was typed while
 * the swap was on its way, and returns the merged text when it differs from what the box holds now (null otherwise).
 */
export async function syncLiveText(
  editor: LiveTextEditor,
  read: () => string | null,
  exchange: (update: string | null, stateVector: string) => Promise<LiveTextReply>,
): Promise<string | null> {
  const before = read()
  if (before === null) return null
  editor.edit(before)
  const { update, stateVector } = editor.outgoing()
  const reply = await exchange(update, stateVector)
  const now = read() ?? before
  editor.edit(now)
  const merged = editor.incoming(reply)
  return merged === now ? null : merged
}
