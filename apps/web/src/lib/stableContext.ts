import { createContext, type Context } from 'react'

type Registry = Map<string, Context<unknown>>
const scope = globalThis as typeof globalThis & { __ramuContexts?: Registry }

/**
 * A React context that survives a development hot reload. Editing a file a provider module imports can re-run that
 * module; a plain `createContext` then makes a second context, so components reading the new one no longer see the
 * provider already on screen and the whole window fails with "Provider missing". In a build there are no hot reloads
 * and this is `createContext`.
 */
export function stableContext<T>(name: string, initial: T, hot = Boolean(import.meta.hot)): Context<T> {
  if (!hot) return Object.assign(createContext(initial), { displayName: name })
  const registry = (scope.__ramuContexts ??= new Map())
  const kept = registry.get(name) as Context<T> | undefined
  if (kept) return kept
  const context = Object.assign(createContext(initial), { displayName: name })
  registry.set(name, context as Context<unknown>)
  return context
}
