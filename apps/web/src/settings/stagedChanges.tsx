import { createContext, useContext } from 'react'
import { sameValue } from '@ramu/shared/settingsCompatibility'

/** A setting saved outside the app preferences, held until Save changes. `apply` writes it. */
export interface StagedChange {
  value: unknown
  apply: (value: never) => unknown
}
export type StagedChanges = ReadonlyMap<string, StagedChange>

/** Staging a setting back to its saved value drops it, so Save changes only lights up for a real difference. */
export function withStaged(
  changes: StagedChanges,
  key: string,
  value: unknown,
  saved: unknown,
  apply: StagedChange['apply'],
): StagedChanges {
  const next = new Map(changes)
  if (sameValue(value, saved)) next.delete(key)
  else next.set(key, { value, apply })
  return next
}

/** Applies in the order they were made and stops at the first failure, keeping what has not been applied. */
export async function commitStaged(changes: StagedChanges) {
  const left = new Map(changes)
  for (const [key, change] of changes) {
    try {
      await change.apply(change.value as never)
      left.delete(key)
    } catch (error) {
      return { left: left as StagedChanges, error }
    }
  }
  return { left: left as StagedChanges, error: null }
}

interface Staging {
  changes: StagedChanges
  stage: <T>(key: string, value: T, saved: T, apply: (value: T) => unknown) => void
}

export const StagingContext = createContext<Staging | null>(null)

/** Reads and stages settings by key, for lists where each row is one setting. */
export function useStaging() {
  const staging = useContext(StagingContext)
  return {
    valueOf: <T,>(key: string, saved: T) => (staging?.changes.get(key)?.value as T | undefined) ?? saved,
    stage: <T,>(key: string, value: T, saved: T, apply: (value: T) => unknown) => {
      if (staging) staging.stage(key, value, saved, apply)
      else void apply(value)
    },
  }
}

/** A setting that takes effect on Save changes and is dropped by Cancel. Reads the staged value while there is one. */
export function useStagedValue<T>(key: string, saved: T, apply: (value: T) => unknown): [T, (value: T) => void] {
  const { valueOf, stage } = useStaging()
  return [valueOf(key, saved), (value) => stage(key, value, saved, apply)]
}
