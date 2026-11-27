import { useSyncExternalStore } from 'react'
import { projectGroupKey } from '@ramu/shared/repositoryIdentity'
import type { Project } from '@ramu/shared/types'
import { deviceStorage } from '../deviceStorage'

const KEY = 'sidebar:projectsByHost'

/** This device's choice: one repository's projects on several hosts as one group (the default) or one per host. */
export function useSeparateByHost(): [boolean, (separate: boolean) => void] {
  const separate = useSyncExternalStore(
    (listener) => deviceStorage.subscribe((key) => key === KEY && listener()),
    () => deviceStorage.getItem(KEY) === 'separate',
  )
  const set = (next: boolean) => (next ? deviceStorage.setItem(KEY, 'separate') : deviceStorage.removeItem(KEY))
  return [separate, set]
}

/** One repository's project on each host that has it. */
export interface SharedProject {
  key: string
  name: string
  members: { host: string; project: Project }[]
}

/**
 * Repositories that two or more hosts have, in the order their first host lists them: these show once across hosts.
 * A project without a remote, or on one host only, stays in its host's own list.
 */
export function sharedProjects(hosts: { host: string; projects: Project[] }[]): SharedProject[] {
  const groups = new Map<string, SharedProject>()
  for (const { host, projects } of hosts)
    for (const project of projects) {
      if (!project.repository) continue
      const key = projectGroupKey(host, project)
      const group = groups.get(key) ?? { key, name: project.name, members: [] }
      group.members.push({ host, project })
      groups.set(key, group)
    }
  return [...groups.values()].filter((group) => new Set(group.members.map((member) => member.host)).size > 1)
}
