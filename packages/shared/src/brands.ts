// Which brand mark the desktop, the phone and the site show beside a forge, platform or service's name.
import type { AccountPlatform, MediaService } from './types/deploy'
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
  'docker',
  'neon',
  'supabase',
  'upstash',
  'resend',
  'postgres',
  'sentry',
  'expo',
  'appstore',
  'googleplay',
  'grafana',
  'salesforce',
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

/**
 * The mark beside a hosting account: the platform's own, Docker's for the person's own server, which runs it, and
 * GitHub's for GitHub Pages and Cloudflare's for Workers, D1, KV and R2; none for a service without a mark here.
 */
export function accountBrand(platform: AccountPlatform): BrandId | undefined {
  // Amplitude's mark is not in Simple Icons and its guidelines are for its partners, so it shows the generic shape; so do
  // the media services, whose marks are only listed beside their names.
  if (platform === 'amplitude' || platform === 'gemini' || platform === 'elevenlabs' || platform === 'openai')
    return undefined
  if (platform === 'server') return 'docker'
  if (platform === 'github-pages') return 'github'
  if (platform === 'vercel-marketplace' || platform === 'vercel-blob') return 'vercel'
  if (platform === 'supabase-storage') return 'supabase'
  return platform.startsWith('cloudflare')
    ? 'cloudflare'
    : (platform as Exclude<
        AccountPlatform,
        | `cloudflare-${string}`
        | 'server'
        | 'github-pages'
        | 'vercel-marketplace'
        | 'vercel-blob'
        | 'supabase-storage'
        | 'amplitude'
        | MediaService
      >)
}
