import { validProfileId } from '@ramu/shared/browser'
import { BrowserProfiles } from './browserProfiles'
import type { BrowserRuntime } from './browserRuntime'

export interface BrowserProfileActions {
  clearData(id: string): Promise<void>
  resetDefault(id: string): Promise<void>
  confirm(input: { name: string; deleteProfile: boolean; tabs: number }): Promise<boolean>
  runtimes?(): BrowserRuntime[]
  changed(): void
}

/** Local administration only. Confirm the exact affected contexts, then close them before clearing website data. */
export async function browserProfileMethod(
  profiles: BrowserProfiles,
  runtime: BrowserRuntime,
  actions: BrowserProfileActions,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (method === 'browser.profiles.list') return profiles.catalog()
  if (method === 'browser.profiles.create') {
    const created = profiles.create(args[1])
    actions.changed()
    return created
  }
  const id = args[1]
  if (!validProfileId(id)) throw new Error('Invalid browser profile')
  if (method === 'browser.profiles.rename') {
    profiles.rename(id, args[2])
    actions.changed()
    return
  }
  if (method !== 'browser.profiles.clear' && method !== 'browser.profiles.delete')
    throw new Error('Unknown browser profile action')
  const remove = method === 'browser.profiles.delete'
  if (remove) profiles.requireCustom(id)
  const profile = profiles.catalog().profiles.find((candidate) => candidate.id === id)
  if (!profile || profile.temporary) throw new Error('Choose a persistent browser profile.')
  const runtimes = () => actions.runtimes?.() ?? [runtime]
  const tabs = () =>
    runtimes()
      .flatMap((entry) => entry.list())
      .filter((tab) => tab.profileId === id)
      .map((tab) => tab.id)
      .sort()
      .join(',')
  const reviewed = tabs()
  const accepted = await actions.confirm({
    name: profile.name,
    deleteProfile: remove,
    tabs: reviewed ? reviewed.split(',').length : 0,
  })
  if (!accepted) return { cancelled: true }
  if (reviewed !== tabs() || profiles.catalog().profiles.find((entry) => entry.id === id)?.name !== profile.name)
    throw new Error('The profile or its tabs changed. Review the action again.')
  const closeContexts = (contexts: BrowserRuntime[], operation: () => Promise<void>): Promise<void> => {
    const [first, ...rest] = contexts
    return first ? first.withClosedProfile(id, () => closeContexts(rest, operation)) : operation()
  }
  await profiles.withLock(id, () =>
    closeContexts(runtimes(), async () => {
      await actions.clearData(id)
      if (remove) {
        await actions.resetDefault(id)
        profiles.remove(id)
      }
    }),
  )
  actions.changed()
  return { cancelled: false }
}
