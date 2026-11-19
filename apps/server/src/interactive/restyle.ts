// Restyle: a deck, dashboard or design drawn again from its source with the host's design system, as a new version.
import { ARTIFACT_SOURCE_FILES, designTokensOf } from '@ramu/shared/artifacts'
import { designTokenCss, parseArtifactSource } from '@ramu/shared/artifactSource'
import { renderArtifactSource } from './kinds'
import type { PageStore } from './pages'

const SOURCES = {
  slides: ARTIFACT_SOURCE_FILES.slides,
  dashboard: ARTIFACT_SOURCE_FILES.dashboard,
  design: ARTIFACT_SOURCE_FILES.design,
} as const

export async function restyleArtifact(pages: PageStore, artifactId: string, base: number, systemId: string | null) {
  const tokens = systemId && pages.has(systemId) ? designTokensOf(pages.document(systemId)) : null
  if (!systemId || !tokens) throw new Error('Choose a design system first: Use as design system on a design.')
  const artifact = pages.get(artifactId)
  const path = SOURCES[artifact.kind as keyof typeof SOURCES]
  const document = pages.document(artifactId, base)
  const stored = path && document.files?.find((file) => file.path === path)?.content
  if (!stored) throw new Error('Only a deck, dashboard or design can be restyled.')
  const raw = JSON.parse(stored) as Record<string, unknown>
  // A design restyled with another system follows it rather than its own tokens.
  delete raw.tokens
  const images = (document.files ?? []).filter((file) => file.encoding === 'base64')
  const drawn = await renderArtifactSource(parseArtifactSource({ kind: artifact.kind, ...raw }), artifact.title, images)
  return pages.saveEdit(
    artifactId,
    base,
    { ...drawn, html: designTokenCss(tokens) + drawn.html },
    `Restyled with ${pages.get(systemId).title}`,
  )
}
