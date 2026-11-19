import type { InteractiveDocument, InteractiveState } from './interactive'
import { readInteractiveState } from './interactive'
export interface ContentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
/** Host-scoped by the caller. State writes never reserialize the much larger offline document bundles. */
export function interactiveStorage(storage: ContentStorage, scope: string) {
  const key = `ramu.interactive.${scope}`
  type Entry = {
    id: string
    state?: InteractiveState | null
    document?: InteractiveDocument
    name?: string
    content?: string
  }
  const read = (suffix: string): Entry[] => {
    try {
      const v = JSON.parse(storage.getItem(key + suffix) ?? '[]')
      return Array.isArray(v) ? v.slice(0, 30) : []
    } catch {
      return []
    }
  }
  const identity = (id: string, version: number) => `${id}:${version}`
  const write = (suffix: string, entry: Entry, count: number, limit: number) => {
    const next = [entry, ...read(suffix).filter((e) => e.id !== entry.id)].slice(0, count)
    try {
      while (JSON.stringify(next).length > limit && next.length) next.pop()
      storage.setItem(key + suffix, JSON.stringify(next))
      return next.some((e) => e.id === entry.id)
    } catch {
      /* Full/locked storage never prevents using a document. */
      return false
    }
  }
  const scenarios = (id: string, version: number) =>
    read('.scenarios').flatMap((entry) => {
      const state = readInteractiveState(entry.state)
      return entry.content === identity(id, version) &&
        typeof entry.name === 'string' &&
        entry.name.length <= 80 &&
        state
        ? [{ name: entry.name, state }]
        : []
    })
  return {
    scenarios,
    saveScenario: (id: string, version: number, name: string, value: unknown): boolean => {
      const state = readInteractiveState(value),
        label = name.trim()
      if (!state || !label || label.length > 80) return false
      const scenarioId = JSON.stringify([id, version, label])
      const saved = read('.scenarios')
      if (saved.length >= 20 && !saved.some((entry) => entry.id === scenarioId)) return false
      const existing = scenarios(id, version)
      if (existing.length >= 6 && !existing.some((entry) => entry.name === label)) return false
      return write('.scenarios', { id: scenarioId, content: identity(id, version), name: label, state }, 20, 1_000_000)
    },
    removeScenario: (id: string, version: number, name: string): boolean => {
      try {
        storage.setItem(
          key + '.scenarios',
          JSON.stringify(read('.scenarios').filter((entry) => entry.id !== JSON.stringify([id, version, name]))),
        )
        return true
      } catch {
        return false
      }
    },
    references: () =>
      read('.documents').flatMap((entry) => (entry.document?.reference ? [entry.document.reference] : [])),
    state: (id: string, version: number) =>
      readInteractiveState(read('.states').find((e) => e.id === identity(id, version))?.state),
    document: (id: string, version: number) =>
      read('.documents').find((e) => e.id === identity(id, version))?.document ?? null,
    saveState: (id: string, version: number, value: unknown) => {
      const state = value === null ? null : readInteractiveState(value)
      if (value === null || state) write('.states', { id: identity(id, version), state }, 30, 1_000_000)
    },
    saveDocument: (document: InteractiveDocument) =>
      write('.documents', { id: identity(document.reference.id, document.reference.version), document }, 4, 3_000_000),
  }
}
