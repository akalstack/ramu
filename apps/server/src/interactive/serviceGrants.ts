// Which plugin data sources each kept Dashboard may read: its own grant per data source, given by the person on the
// dashboard and taken back there or in its settings. A dashboard naming a data source it was not allowed reads nothing
// from it.
import { DATA_SOURCE_ID } from '@ramu/shared/artifactSource'

const key = (artifactId: string) => `artifact-services:${artifactId}`

export class ServiceGrants {
  constructor(
    private readonly getState: <T>(key: string, fallback: T) => T,
    private readonly setState: (key: string, value: unknown) => void,
  ) {}

  allowed(artifactId: string): string[] {
    const value = this.getState<unknown>(key(artifactId), [])
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && DATA_SOURCE_ID.test(entry))
      : []
  }

  set(artifactId: string, service: string, allowed: boolean): string[] {
    const next = this.allowed(artifactId).filter((entry) => entry !== service)
    if (allowed) next.push(service)
    this.setState(key(artifactId), next)
    return next
  }
}
