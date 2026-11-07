// Databases and storage behind one small interface, the counterpart of `HostingAdapter` for what an app keeps its data
// in. A provider creates a resource on the person's own account and hands back the variables the app connects with.
// Deleting a resource is deliberately not here: it is done on the provider's own page.
import type { ResourceKind, ResourcePlan, ResourceProvider } from '@ramu/shared/types/deploy'
import type { HostingAuth, HostingIdentity, PlatformUsage } from './adapter'

/** A resource at the provider, and the variables that connect to it. */
export interface ProvisionedResource {
  id: string
  name: string
  variables: Record<string, string>
}

export interface ResourceAdapter {
  readonly id: ResourceProvider
  readonly name: string
  readonly kind: ResourceKind
  readonly tokenPage: string
  readonly plans: ResourcePlan[]
  account(auth: HostingAuth): Promise<HostingIdentity>
  /** Creates a resource named after the project; `site` is the project's id on the platform it deploys to. */
  provision(auth: HostingAuth, project: { name: string; site?: string }, plan: string): Promise<ProvisionedResource>
  /** A resource of that name already on the account, for a provision whose reply was lost. */
  find(auth: HostingAuth, name: string): Promise<ProvisionedResource | null>
  /** The provider's page for a resource. */
  page(id: string): string
  /** A copy of the resource for previews and development, created once and reused, with its own variables. */
  branch?(auth: HostingAuth, id: string, name: string): Promise<Record<string, string>>
  /** Deletes a branch `branch` made; nothing when it is already gone. */
  removeBranch?(auth: HostingAuth, id: string, name: string): Promise<void>
  /** What the resource used in the current billing period, as far as the provider's API reports it. */
  usage?(auth: HostingAuth, id: string): Promise<PlatformUsage>
}

const adapters = new Map<ResourceProvider, ResourceAdapter>()

/** Registers an adapter once, at module load. A second registration for the same id is a bug. */
export function registerResourceAdapter(adapter: ResourceAdapter): ResourceAdapter {
  if (adapters.has(adapter.id)) throw new Error(`A resource adapter for ${adapter.id} is already registered`)
  adapters.set(adapter.id, adapter)
  return adapter
}

/** The adapter for a provider; throws for one with no adapter so a caller never gets a silent no-op. */
export function resourceAdapter(id: ResourceProvider): ResourceAdapter {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`No resource adapter for ${id}`)
  return adapter
}
