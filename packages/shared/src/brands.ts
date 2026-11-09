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
  'postgres',
  'sentry',
  'expo',
  'appstore',
  'googleplay',
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

/** The mark beside an account: the platform's own. */
export function accountBrand(platform: AccountPlatform): BrandId {
  // Typed, so a new account platform without a mark fails here rather than showing nothing.
  return platform
}
