// The host's side of live typing on a doc's or Mermaid diagram's text, or a deck's words: one Yjs document per artifact while anyone is
// editing it, started from the current version's text. Editors join, then sync about once a second. When nobody has
// typed for a minute, the text is saved as a version (merged onto any version an agent saved meanwhile) naming who
// typed, so Restore and Compare keep working; a document nobody synced for five minutes is dropped after that save.
import { LiveTextHost, type LiveTextReply } from '@ramu/shared/liveText'
import { mergeText } from '@ramu/shared/textMerge'

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
      if (!current) throw new Error('Only a doc, a Mermaid diagram or a deck’s words are edited live.')
      session = {
        host: new LiveTextHost(current.text),
        base: current.version,
        saved: current.text,
        changedAt: this.now(),
        touchedAt: this.now(),
        typed: new Set(),
      }
      this.sessions.set(artifactId, session)
    } else if (session.host.text === session.saved) {
      // Nothing typed is waiting: a version an agent or Save made since the copy began becomes its text.
      const current = this.host.current(artifactId)
      if (current && current.version !== session.base) this.adopt(session, current.version, current.text, session.saved)
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
    return { ...session.host.exchange(update, stateVector), version: session.base }
  }

  /** A version Save made from an editor's text: the shared copy takes it, so the host does not save older text later. */
  saved(artifactId: string, version: number, text: string): void {
    const session = this.sessions.get(artifactId)
    if (!session) return
    session.typed.clear()
    this.adopt(session, version, text, session.host.text)
  }

  /** Cancel: what was typed since the last save goes, unless someone other than `who` typed too. */
  discard(artifactId: string, who: string): void {
    const session = this.sessions.get(artifactId)
    if (!session || [...session.typed].some((name) => name !== who)) return
    session.typed.clear()
    session.host.replace(session.saved)
  }

  /**
   * Makes `version` the copy's base. `from` is the text that version was made from: typing that reached the copy
   * since then is kept on top of the version's text, so a merge with an agent's version shows in every editor.
   */
  private adopt(session: Session, version: number, text: string, from: string) {
    const now = session.host.text
    session.host.replace(now === from ? text : (mergeText(from, now, text) ?? now))
    session.base = version
    session.saved = text
  }

  /** Saves each document nobody has typed in for a minute, and drops the ones nobody synced for five. */
  async flush(): Promise<void> {
    for (const [artifactId, session] of this.sessions) {
      const text = session.host.text
      if (text !== session.saved && this.now() - session.changedAt >= IDLE_SAVE_MS) {
        const names = [...session.typed]
        session.typed.clear()
        try {
          const version = await this.host.save(
            artifactId,
            session.base,
            text,
            `Edited live by ${names.join(' and ') || 'you'}`,
          )
          // The saved version can differ from the copy when it was merged onto an agent's version.
          const current = this.host.current(artifactId)
          this.adopt(session, version, current?.version === version ? current.text : text, text)
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
