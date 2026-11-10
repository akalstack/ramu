import { Boxes, Cloud, Database, GitBranch } from 'lucide-react'
import type { BrandFallback, BrandId } from '@ramu/shared/brands'
import { useResolvedAppearance } from '../appearance'
import github from '../assets/brands/github.svg'
import githubDark from '../assets/brands/github-dark.svg'
import gitlab from '../assets/brands/gitlab.svg'
import bitbucket from '../assets/brands/bitbucket.svg'
import azureDevops from '../assets/brands/azure-devops.svg'
import vercel from '../assets/brands/vercel.svg'
import vercelDark from '../assets/brands/vercel-dark.svg'
import netlify from '../assets/brands/netlify.svg'
import cloudflare from '../assets/brands/cloudflare.svg'
import fly from '../assets/brands/fly.svg'
import railway from '../assets/brands/railway.svg'
import railwayDark from '../assets/brands/railway-dark.svg'
import neon from '../assets/brands/neon.svg'
import postgres from '../assets/brands/postgres.svg'
import sentry from '../assets/brands/sentry.svg'
import sentryDark from '../assets/brands/sentry-dark.svg'
import expo from '../assets/brands/expo.svg'
import expoDark from '../assets/brands/expo-dark.svg'
import appstore from '../assets/brands/appstore.svg'
import googleplay from '../assets/brands/googleplay.svg'
import gemini from '../assets/brands/gemini.svg'
import elevenlabs from '../assets/brands/elevenlabs.svg'
import elevenlabsDark from '../assets/brands/elevenlabs-dark.svg'
import supabase from '../assets/brands/supabase.svg'
import grafana from '../assets/brands/grafana.svg'
import godot from '../assets/brands/godot.svg'
import unity from '../assets/brands/unity.svg'
import unityDark from '../assets/brands/unity-dark.svg'
import notion from '../assets/brands/notion.svg'
import notionDark from '../assets/brands/notion-dark.svg'
import linear from '../assets/brands/linear.svg'
import figma from '../assets/brands/figma.svg'
import stripe from '../assets/brands/stripe.svg'
import atlassian from '../assets/brands/atlassian.svg'

/** Each brand's own mark in its own colors; a black mark has a light version for dark surfaces. */
const MARKS: Record<BrandId, { light: string; dark?: string }> = {
  github: { light: github, dark: githubDark },
  gitlab: { light: gitlab },
  bitbucket: { light: bitbucket },
  'azure-devops': { light: azureDevops },
  vercel: { light: vercel, dark: vercelDark },
  netlify: { light: netlify },
  cloudflare: { light: cloudflare },
  fly: { light: fly },
  railway: { light: railway, dark: railwayDark },
  neon: { light: neon },
  postgres: { light: postgres },
  sentry: { light: sentry, dark: sentryDark },
  expo: { light: expo, dark: expoDark },
  appstore: { light: appstore },
  googleplay: { light: googleplay },
  gemini: { light: gemini },
  elevenlabs: { light: elevenlabs, dark: elevenlabsDark },
  supabase: { light: supabase },
  grafana: { light: grafana },
  godot: { light: godot },
  unity: { light: unity, dark: unityDark },
  notion: { light: notion, dark: notionDark },
  linear: { light: linear },
  figma: { light: figma },
  stripe: { light: stripe },
  atlassian: { light: atlassian },
}
const FALLBACKS = { git: GitBranch, cloud: Cloud, database: Database, service: Boxes }

/**
 * A forge, hosting platform or service's own mark in its own colors. It sits beside the brand's name, never instead of
 * it, so it is hidden from screen readers. A brand without a mark shows a generic shape, so a new adapter never leaves a
 * gap.
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
  const appearance = useResolvedAppearance()
  const mark = brand ? MARKS[brand] : undefined
  if (!mark) {
    const Shape = FALLBACKS[fallback]
    return <Shape size={size} className={className} aria-hidden="true" />
  }
  return (
    <img
      src={appearance === 'dark' ? (mark.dark ?? mark.light) : mark.light}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-brand={brand}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  )
}
