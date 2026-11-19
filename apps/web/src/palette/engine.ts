import {
  capResults,
  isAsyncIterable,
  isBatch,
  parsePaletteQuery,
  sourceApplies,
  type PaletteResult,
  type PaletteSource,
  type QueryMode,
} from './sources'

export interface PaletteGroup {
  id: string
  label: string
  priority: number
  initialShow: number
  status: 'loading' | 'done' | 'error'
  results: PaletteResult[]
  limited: boolean
  /** Results are from the previous query while the new one is still running. */
  stale: boolean
  error?: string
}

export interface PaletteSnapshot {
  mode: QueryMode
  text: string
  /** Groups in priority order; sources that do not apply to the query are absent. */
  groups: PaletteGroup[]
  /** Some source is still waiting or running. */
  pending: boolean
}

interface Entry {
  text: string
  mode: QueryMode
  scope?: string
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  group: PaletteGroup
}

const errorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))

/**
 * Runs sources for each query and publishes one snapshot per change. Synchronous sources are
 * resolved before `run` returns. Asynchronous ones are debounced and each has its own
 * AbortController: a newer query for the same source aborts the old one, and anything the old one
 * still delivers is dropped because its entry is no longer the current one.
 */
export function createPaletteEngine(onChange: (snapshot: PaletteSnapshot) => void) {
  const entries = new Map<string, Entry>()
  let parsed = parsePaletteQuery('')
  let disposed = false

  const snapshot = (): PaletteSnapshot => {
    const groups = [...entries.values()].map((entry) => entry.group).sort((a, b) => a.priority - b.priority)
    return { ...parsed, groups, pending: groups.some((group) => group.status === 'loading') }
  }
  const publish = () => {
    if (!disposed) onChange(snapshot())
  }
  const drop = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    entry.controller.abort()
    entries.delete(id)
  }
  const update = (entry: Entry, patch: Partial<PaletteGroup>) => {
    entry.group = { ...entry.group, ...patch }
    publish()
  }

  /** Consumes whatever the source returned. Stale deliveries never reach the snapshot. */
  const consume = (source: PaletteSource, entry: Entry, quiet: boolean) => {
    const { signal } = entry.controller
    const current = () => entries.get(source.id) === entry && !signal.aborted
    const fail = (reason: unknown) => {
      if (current()) update(entry, { status: 'error', error: errorMessage(reason), stale: false })
    }
    let output
    try {
      output = source.query(entry.text, { signal, limit: source.limit, mode: entry.mode })
    } catch (reason) {
      entry.group = { ...entry.group, status: 'error', error: errorMessage(reason), stale: false }
      if (!quiet) publish()
      return
    }
    if (isBatch(output)) {
      const capped = capResults(output.results, source.limit)
      entry.group = {
        ...entry.group,
        status: 'done',
        results: capped.results,
        limited: capped.limited || !!output.limited,
        stale: false,
      }
      if (!quiet) publish()
    } else if (isAsyncIterable(output)) {
      const stream = output
      void (async () => {
        let results: PaletteResult[] = []
        let limited = false
        try {
          for await (const batch of stream) {
            if (!current()) return
            const capped = capResults([...results, ...batch.results], source.limit)
            results = capped.results
            limited ||= capped.limited || !!batch.limited
            update(entry, { results, limited, stale: false })
            if (capped.limited) break
          }
          if (current()) update(entry, { status: 'done', results, limited, stale: false })
        } catch (reason) {
          fail(reason)
        }
      })()
    } else {
      output.then((batch) => {
        if (!current()) return
        const capped = capResults(batch.results, source.limit)
        update(entry, {
          status: 'done',
          results: capped.results,
          limited: capped.limited || !!batch.limited,
          stale: false,
        })
      }, fail)
    }
  }

  return {
    run(sources: readonly PaletteSource[], raw: string) {
      parsed = parsePaletteQuery(raw)
      const live = new Set<string>()
      for (const source of sources) {
        if (!sourceApplies(source, parsed)) continue
        live.add(source.id)
        const previous = entries.get(source.id)
        // A slow source already working on this exact query keeps going when only the sources' inputs changed.
        if (
          source.debounceMs > 0 &&
          previous &&
          previous.text === parsed.text &&
          previous.mode === parsed.mode &&
          previous.scope === source.scope
        )
          continue
        const carried = previous?.scope === source.scope ? (previous?.group.results ?? []) : []
        drop(source.id)
        const entry: Entry = {
          text: parsed.text,
          mode: parsed.mode,
          scope: source.scope,
          controller: new AbortController(),
          group: {
            id: source.id,
            label: source.label,
            priority: source.priority,
            initialShow: source.initialShow,
            status: 'loading',
            results: source.debounceMs > 0 ? carried : [],
            limited: false,
            stale: source.debounceMs > 0 && carried.length > 0,
          },
        }
        entries.set(source.id, entry)
        if (source.debounceMs > 0) entry.timer = setTimeout(() => consume(source, entry, false), source.debounceMs)
        else consume(source, entry, true)
      }
      for (const id of [...entries.keys()]) if (!live.has(id)) drop(id)
      publish()
    },
    /** Cancels everything in flight and stops publishing. */
    dispose() {
      disposed = true
      for (const id of [...entries.keys()]) drop(id)
    },
  }
}
