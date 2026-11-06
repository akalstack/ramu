import { z } from 'zod'

/** Markdown for a Doc: long reports fit, a book does not. */
const DOC_MAX_SOURCE = 200_000
/** Mermaid text for a Diagram, the same bound the chat's diagram renderer draws. */
const MERMAID_MAX_SOURCE = 50_000
/** Hand-written SVG for a Diagram. */
const SVG_MAX_SOURCE = 300_000

const docSource = z.object({
  kind: z.literal('doc'),
  source: z
    .string({ error: 'Write the doc as Markdown in source.' })
    .max(DOC_MAX_SOURCE, `A doc is at most ${DOC_MAX_SOURCE / 1000} KB of Markdown.`)
    .refine((text) => text.trim().length > 0, 'Write the doc as Markdown in source.'),
})
const diagramSource = z
  .object({
    kind: z.literal('diagram'),
    format: z.enum(['mermaid', 'svg'], { error: 'Say which the diagram is written in: format "mermaid" or "svg".' }),
    source: z
      .string({ error: 'Write the diagram in source.' })
      .refine((text) => text.trim().length > 0, 'Write the diagram in source.'),
  })
  .superRefine((value, ctx) => {
    const limit = value.format === 'mermaid' ? MERMAID_MAX_SOURCE : SVG_MAX_SOURCE
    if (value.source.length > limit)
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: `A ${value.format === 'mermaid' ? 'Mermaid' : 'SVG'} diagram is at most ${limit / 1000} KB.`,
      })
    if (value.format === 'svg' && !/<svg[\s>]/i.test(value.source))
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'An SVG diagram needs an <svg> element.' })
  })

/** The source of an artifact that is not an App, checked per kind before anything is drawn. */
const artifactSourceSchema = z.discriminatedUnion('kind', [docSource, diagramSource])
export type ArtifactSource = z.infer<typeof artifactSourceSchema>

/** Reads a kind's source from tool input, with the first problem as a sentence the author can act on. */
export function parseArtifactSource(input: { kind: string; source?: string; format?: string }): ArtifactSource {
  const result = artifactSourceSchema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  throw new Error(issue?.message ?? 'The source does not fit this kind.')
}
