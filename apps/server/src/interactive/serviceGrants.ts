// Which named services each kept Dashboard may read: its own grant per service, given by the person on the dashboard
// and taken back there or in its settings. A dashboard naming a service it was not allowed reads nothing from it.
import { NAMED_SERVICES, type NamedService } from '@ramu/shared/types/deploy'

const key = (artifactId: string) => `artifact-services:${artifactId}`

export class ServiceGrants {
  constructor(
    private readonly getState: <T>(key: string, fallback: T) => T,
    private readonly setState: (key: string, value: unknown) => void,
  ) {}

  allowed(artifactId: string): NamedService[] {
    const value = this.getState<unknown>(key(artifactId), [])
    return Array.isArray(value) ? NAMED_SERVICES.filter((service) => (value as unknown[]).includes(service)) : []
  }

  set(artifactId: string, service: NamedService, allowed: boolean): NamedService[] {
    const next: NamedService[] = this.allowed(artifactId).filter((entry) => entry !== service)
    if (allowed) next.push(service)
    this.setState(key(artifactId), next)
    return next
  }
}
