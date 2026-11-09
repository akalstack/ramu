import { randomUUID } from 'node:crypto'
import {
  PERSON_ONLY,
  sameValue,
  type AgentSettingMark,
  type SettingEdit,
  type SettingSchema,
  type SettingsSnapshot,
  type SharedSetting,
} from '@ramu/shared/settingsCompatibility'
import { catalogEntryFor, findSettingsEntries } from '@ramu/shared/settingsCatalog'
import { SETTINGS_MENU, type SettingsMenuId } from '@ramu/shared/settingsMenu'
import type { SettingsChangeCard, SettingsChangeRow } from '@ramu/shared/settingsChanges'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { applySettingEdits, validateSettingModels } from '../sharedSettings'
import { appPreferences, appPreferencesSchema } from '../ipc/preferences'

const CARDS = 'settings-change-cards'
const MARKS = 'settings-agent-marks'
/** Cards kept per host; the oldest go first. */
const MAX_CARDS = 200

/** Settings Ramu stores on the host, read and saved the way Settings itself saves them. */
export interface SettingsAccess {
  snapshot(): Promise<SettingsSnapshot>
  /** Saves through the same checks as Settings; refuses an edit whose `before` is no longer the saved value. */
  patch(edits: SettingEdit[]): Promise<SettingsSnapshot>
}

interface Store {
  getAppState<T>(key: string, fallback: T): T
  setAppState(key: string, value: unknown): void
}

interface Sessions {
  get(sessionId: string): Pick<AgentSessionInfo, 'taskId' | 'settings'>
  settingsChangeShown(sessionId: string, cardId: string): void
}

const pageLabel = (section: SettingsMenuId) =>
  SETTINGS_MENU.find((entry) => entry.id === section)?.label ?? section

/** A setting's constraints for an agent: its allowed values and limits, without Settings' own annotations. */
function allowedValues(schema: SettingSchema): SettingSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => !['description', 'title', '$schema', PERSON_ONLY].includes(key)),
  )
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * What agents ask to change in Ramu's settings. Each request lands in a card in the thread: Full access applies it at
 * once and offers Undo, every other mode waits for the person. A setting marked `PERSON_ONLY` is never changed here.
 * Rows an agent changed keep a mark naming the thread until the person changes them again.
 */
export class SettingsChanges {
  constructor(
    private readonly store: Store,
    private readonly sessions: Sessions,
    private readonly settings: SettingsAccess,
    private readonly threadName: (taskId: string) => string,
    private readonly changed: () => void,
  ) {}

  list(): SettingsChangeCard[] {
    return this.store.getAppState<SettingsChangeCard[]>(CARDS, [])
  }

  get(cardId: string): SettingsChangeCard | null {
    return this.list().find((card) => card.id === cardId) ?? null
  }

  private save(card: SettingsChangeCard): SettingsChangeCard {
    const others = this.list().filter((entry) => entry.id !== card.id)
    this.store.setAppState(CARDS, [...others, card].slice(-MAX_CARDS))
    this.changed()
    return card
  }

  /** Rows an agent changed that the person has not changed since. */
  marks(): AgentSettingMark[] {
    return this.store.getAppState<AgentSettingMark[]>(MARKS, [])
  }

  /** The person saved these rows themselves, so they no longer show an agent's change. */
  personChanged(paths: string[]): void {
    const marks = this.marks()
    const kept = marks.filter((mark) => !paths.includes(mark.path))
    if (kept.length !== marks.length) this.store.setAppState(MARKS, kept)
  }

  private mark(card: SettingsChangeCard): void {
    const thread = this.threadName(card.taskId)
    const paths = card.rows.map((row) => row.path)
    this.store.setAppState(MARKS, [
      ...this.marks().filter((mark) => !paths.includes(mark.path)),
      ...paths.map((path) => ({ path, taskId: card.taskId, thread, at: Date.now() })),
    ])
  }

  /** Settings rows matching `query`, with what an agent may do with each. */
  async find(query: string) {
    const snapshot = await this.settings.snapshot()
    return findSettingsEntries(query, pageLabel).map((entry) => {
      const field = entry.path ? snapshot.settings.find((setting) => setting.path === entry.path) : undefined
      const where = `Settings → ${pageLabel(entry.section)} → ${entry.title}`
      return {
        title: entry.title,
        page: pageLabel(entry.section),
        ...(entry.help ? { help: entry.help } : {}),
        ...(field
          ? {
              path: field.path,
              current: field.value ?? null,
              allowed: allowedValues(field.schema),
              change: field.agentMayChange ? ('agent' as const) : ('yourself' as const),
            }
          : { change: 'yourself' as const }),
        where,
      }
    })
  }

  /** Validates edits as a save would, without saving: the schema, the whole batch, and any model they name. */
  private check(snapshot: SettingsSnapshot, edits: SettingEdit[]): void {
    const preferences = (snapshot.preferences ?? {}) as Record<string, unknown>
    applySettingEdits(
      appPreferencesSchema,
      appPreferences,
      preferences as Parameters<typeof applySettingEdits>[2],
      edits.filter((edit) => !edit.path.startsWith('$')),
    )
    validateSettingModels(edits, snapshot.catalogs ?? [])
  }

  /**
   * An agent's request: refused for a setting Settings does not show, one only the person may change, or a value the
   * setting does not allow. Otherwise a card shows it, applied at once in Full access.
   */
  async request(sessionId: string, changes: { path: string; value: unknown }[], reason: string) {
    const session = this.sessions.get(sessionId)
    const snapshot = await this.settings.snapshot()
    if (new Set(changes.map((change) => change.path)).size !== changes.length)
      throw new Error('Each setting can appear once in a change.')
    const rows: SettingsChangeRow[] = []
    const fields: SharedSetting[] = []
    for (const change of changes) {
      const entry = catalogEntryFor(change.path)
      const field = snapshot.settings.find((setting) => setting.path === change.path)
      if (!entry || !field)
        throw new Error(`There is no setting “${change.path}” you can change. Find the row with settings_find.`)
      if (!field.agentMayChange)
        throw new Error(
          `Only the person can change “${entry.title}”. Ask them to open Settings → ${pageLabel(entry.section)} → ${entry.title}. Nothing was changed.`,
        )
      if (sameValue(field.value, change.value)) continue
      rows.push({
        path: change.path,
        title: entry.title,
        section: entry.section,
        before: field.value,
        value: change.value,
      })
      fields.push(field)
    }
    if (!rows.length) return { state: 'unchanged' as const }
    try {
      this.check(
        snapshot,
        rows.map((row, index) => ({
          path: row.path,
          schema: fields[index]!.schema,
          before: row.before,
          value: row.value,
        })),
      )
    } catch (error) {
      throw new Error(`${errorText(error)} Nothing was changed.`, { cause: error })
    }
    const card = this.save({
      id: randomUUID(),
      sessionId,
      taskId: session.taskId,
      reason,
      rows,
      state: 'waiting',
      createdAt: Date.now(),
    })
    this.sessions.settingsChangeShown(sessionId, card.id)
    const settled = session.settings.access === 'full' ? await this.apply(card.id) : card
    return {
      state: settled.state,
      cardId: card.id,
      rows: rows.map(({ path, title, before, value }) => ({ path, title, before, value })),
      ...(settled.error ? { error: settled.error } : {}),
    }
  }

  private require(cardId: string): SettingsChangeCard {
    const card = this.get(cardId)
    if (!card) throw new Error('This card is gone. Ask the agent again.')
    return card
  }

  /** Saves a waiting card. A row changed since the agent asked is refused, and the card keeps why. */
  async apply(cardId: string): Promise<SettingsChangeCard> {
    const card = this.require(cardId)
    if (card.state !== 'waiting') return card
    const snapshot = await this.settings.snapshot()
    const moved = card.rows.find(
      (row) => !sameValue(snapshot.settings.find((setting) => setting.path === row.path)?.value, row.before),
    )
    if (moved)
      return this.save({
        ...card,
        error: `“${moved.title}” changed after the agent asked. Open it in Settings to choose.`,
      })
    try {
      await this.settings.patch(this.edits(snapshot, card.rows, 'forward'))
    } catch (error) {
      return this.save({ ...card, error: errorText(error) })
    }
    this.mark(card)
    return this.save({ ...card, state: 'applied', error: undefined })
  }

  /** Puts back the values from before an applied card; refused for a row the person changed since. */
  async undo(cardId: string): Promise<SettingsChangeCard> {
    const card = this.require(cardId)
    if (card.state !== 'applied') return card
    const snapshot = await this.settings.snapshot()
    const moved = card.rows.find(
      (row) => !sameValue(snapshot.settings.find((setting) => setting.path === row.path)?.value, row.value),
    )
    if (moved)
      return this.save({
        ...card,
        error: `“${moved.title}” was changed after the agent changed it, so Undo would overwrite that. Open it in Settings to choose.`,
      })
    try {
      await this.settings.patch(this.edits(snapshot, card.rows, 'back'))
    } catch (error) {
      return this.save({ ...card, error: errorText(error) })
    }
    this.personChanged(card.rows.map((row) => row.path))
    return this.save({ ...card, state: 'undone', error: undefined })
  }

  dismiss(cardId: string): SettingsChangeCard {
    const card = this.require(cardId)
    return card.state === 'waiting' ? this.save({ ...card, state: 'dismissed', error: undefined }) : card
  }

  private edits(snapshot: SettingsSnapshot, rows: SettingsChangeRow[], direction: 'forward' | 'back'): SettingEdit[] {
    return rows.map((row) => {
      const field = snapshot.settings.find((setting) => setting.path === row.path)
      if (!field) throw new Error(`This host no longer has “${row.title}”.`)
      return direction === 'forward'
        ? { path: row.path, schema: field.schema, before: row.before, value: row.value }
        : { path: row.path, schema: field.schema, before: row.value, value: row.before }
    })
  }
}
