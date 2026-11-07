import { expect, it } from 'vitest'
import { parseArtifactSource } from '@ramu/shared/artifactSource'
import { STARTER_TEMPLATES } from '@ramu/shared/starterTemplates'
import { renderArtifactSource } from '../src/interactive/kinds'

it('ships one starting point per drawn kind, each a valid source that draws without problems', async () => {
  expect(new Set(STARTER_TEMPLATES.map((template) => template.kind))).toEqual(
    new Set(['doc', 'slides', 'dashboard', 'diagram', 'design', 'motion']),
  )
  for (const template of STARTER_TEMPLATES) {
    const source = parseArtifactSource({ kind: template.kind, ...template.source })
    const drawn = await renderArtifactSource(source, template.title)
    expect(drawn.problems, template.id).toEqual([])
    expect(drawn.html, template.id).not.toContain('<script')
  }
})
