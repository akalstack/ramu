// The host's side of live typing on a doc's or Mermaid diagram's text: one Yjs document per artifact while anyone is
// editing it, started from the current version's text. Editors join, then sync about once a second. When nobody has
// typed for a minute, the text is saved as a version (merged onto any version an agent saved meanwhile) naming who
// typed, so Restore and Compare keep working; a document nobody synced for five minutes is dropped after that save.
import { LiveTextHost, type LiveTextReply } from '@ramu/shared/liveText'

const IDLE_SAVE_MS = 60_000
const DROP_MS = 5 * 60_000

interface Session {
  host: LiveTextHost
  /** The version the text was last saved as, or started from. */
  base: number
  /** The text at that version, so an unchanged document is not saved again. */
  saved: string
  changedAt: number
  touchedAt: number
  /** Who typed since the last save, as the version's note names them. */
  typed: Set<string>
}

export interface LiveEditingHost {
  /** The artifact's current version and its editable text; null for a kind not edited as text. */
  current(artifactId: string): { version: number; text: string } | null
  /** Saves the text as a version on top of `base` (merging when another came since), noting who typed. */
  save(artifactId: string, base: number, text: string, by: string): Promise<number>
}

export class LiveEditing {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly host: LiveEditingHost,
    private readonly now: () => number = Date.now,
  ) {}

  /** The document for an editor joining: its whole state and the version it started from. */
  join(artifactId: string): { state: string; version: number } {
    let session = this.sessions.get(artifactId)
    if (!session) {
      const current = this.host.current(artifactId)
      if (!current) throw new Error('Only a doc or a Mermaid diagram is edited live.')
      session = {
        host: new LiveTextHost(current.text),
        base: current.version,
        saved: current.text,
        changedAt: this.now(),
        touchedAt: this.now(),
        typed: new Set(),
      }
      this.sessions.set(artifactId, session)
    }
    session.touchedAt = this.now()
    return { state: session.host.state(), version: session.base }
  }

  /** Takes an editor's changes and returns what it lacks; `who` names it in the next version's note. */
  sync(artifactId: string, who: string, update: string | null, stateVector: string): LiveTextReply {
    const session = this.sessions.get(artifactId)
    if (!session) throw new Error('This live edit ended. Open the text again.')
    session.touchedAt = this.now()
    if (update) {
      session.changedAt = this.now()
      session.typed.add(who)
    }
    return session.host.exchange(update, stateVector)
  }

  /** Saves each document nobody has typed in for a minute, and drops the ones nobody synced for five. */
  async flush(): Promise<void> {
    for (const [artifactId, session] of this.sessions) {
      const text = session.host.text
      if (text !== session.saved && this.now() - session.changedAt >= IDLE_SAVE_MS) {
        const names = [...session.typed]
        session.typed.clear()
        try {
          session.base = await this.host.save(
            artifactId,
            session.base,
            text,
            `Edited live by ${names.join(' and ') || 'you'}`,
          )
          session.saved = text
        } catch {
          // A conflict with a version saved meanwhile keeps the text live; the editors' own Save shows the reason.
          names.forEach((name) => session.typed.add(name))
        }
      }
      if (this.now() - session.touchedAt >= DROP_MS && session.host.text === session.saved)
        this.sessions.delete(artifactId)
    }
  }
}
