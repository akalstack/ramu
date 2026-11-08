import type { CSSProperties } from 'react'
import { Boxes, Cloud, Database, GitBranch } from 'lucide-react'
import type { BrandFallback, BrandId } from '@ramu/shared/brands'
import github from '../assets/brands/github.svg'
import gitlab from '../assets/brands/gitlab.svg'
import bitbucket from '../assets/brands/bitbucket.svg'
import azureDevops from '../assets/brands/azure-devops.svg'
import vercel from '../assets/brands/vercel.svg'
import netlify from '../assets/brands/netlify.svg'
import cloudflare from '../assets/brands/cloudflare.svg'
import fly from '../assets/brands/fly.svg'
import railway from '../assets/brands/railway.svg'
import neon from '../assets/brands/neon.svg'
import supabase from '../assets/brands/supabase.svg'
import postgres from '../assets/brands/postgres.svg'
import sentry from '../assets/brands/sentry.svg'
import grafana from '../assets/brands/grafana.svg'
import salesforce from '../assets/brands/salesforce.svg'
import expo from '../assets/brands/expo.svg'
import appstore from '../assets/brands/appstore.svg'
import googleplay from '../assets/brands/googleplay.svg'

const MARKS: Record<BrandId, string> = {
  github,
  gitlab,
  bitbucket,
  'azure-devops': azureDevops,
  vercel,
  netlify,
  cloudflare,
  fly,
  railway,
  neon,
  supabase,
  postgres,
  sentry,
  grafana,
  salesforce,
  expo,
  appstore,
  googleplay,
}
const FALLBACKS = { git: GitBranch, cloud: Cloud, database: Database, service: Boxes }

/**
 * A forge, hosting platform or service's mark, drawn as a mask so it follows the theme like the provider marks. It sits
 * beside the brand's name, never instead of it, so it is hidden from screen readers. A brand without a mark shows a
 * generic shape, so a new adapter never leaves a gap.
 */
export function BrandIcon({
  brand,
  fallback = 'service',
  size = 14,
  className,
}: {
  brand: BrandId | null | undefined
  fallback?: BrandFallback
  size?: number
  className?: string
}) {
  const mark = brand ? MARKS[brand] : undefined
  if (!mark) {
    const Shape = FALLBACKS[fallback]
    return <Shape size={size} className={className} aria-hidden="true" />
  }
  const style: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    flexShrink: 0,
    backgroundColor: 'currentColor',
    maskImage: `url("${mark}")`,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  }
  return <span className={className} style={style} aria-hidden="true" data-brand={brand} />
}
