// Which brand mark the desktop, the phone and the site show beside a forge, platform or service's name.
import type { AccountPlatform } from './types/deploy'
import type { ForgeService } from './types/forge'

/** Every brand whose mark ships in `apps/web/src/assets/brands/`. */
export const BRAND_IDS = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
  'vercel',
  'netlify',
  'cloudflare',
  'fly',
  'railway',
  'neon',
  'supabase',
  'postgres',
  'sentry',
  'expo',
  'appstore',
  'googleplay',
  'grafana',
  'salesforce',
  'gemini',
  'elevenlabs',
] as const

export type BrandId = (typeof BRAND_IDS)[number]

/** The generic shape a brand without a mark falls back to, so a new adapter never leaves a gap. */
export type BrandFallback = 'git' | 'cloud' | 'database' | 'service'

const FORGE_BRANDS: Record<ForgeService, BrandId> = {
  github: 'github',
  gitlab: 'gitlab',
  bitbucket: 'bitbucket',
  azure: 'azure-devops',
}

export function forgeBrand(service: ForgeService): BrandId {
  return FORGE_BRANDS[service]
}

/** The mark beside an account: the platform's own; none for a service without a mark here. */
export function accountBrand(platform: AccountPlatform): BrandId | undefined {
  // Amplitude's mark is in neither SVGL nor Simple Icons and its guidelines are for its partners, so it shows the
  // generic shape.
  if (platform === 'amplitude') return undefined
  // Typed, so a new account platform without a mark fails here rather than showing nothing.
  const brand: BrandId = platform
  return brand
}
