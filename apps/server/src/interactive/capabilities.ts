import { z } from 'zod'
import type { PageCapabilities } from '@ramu/shared/pages'
import type { InteractiveInput } from './store'

const name = z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,39}$/, 'Use a short name that starts with a lowercase letter.')
const field = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'file',
  'json',
  'string?',
  'number?',
  'boolean?',
  'date?',
  'file?',
  'json?',
])
const json: z.ZodType<unknown> = z.unknown()
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

export const pageCapabilitiesSchema = z
  .object({
    records: z
      .record(
        name,
        z.object({
          fields: z.record(name, field).refine((fields) => Object.keys(fields).length <= 40, 'At most 40 fields'),
          migrate: z.record(name, z.object({ from: name.optional(), default: json.optional() })).optional(),
        }),
      )
      .refine((records) => Object.keys(records).length <= 12, 'At most 12 collections')
      .optional(),
    ai: z
      .object({
        purpose: z.string().trim().min(3).max(200),
        quality: z.enum(['fast', 'smart']).optional(),
        daily: z.number().int().min(1).max(500).optional(),
        web: z.boolean().optional(),
        mcp: z.array(z.string().max(80)).max(8).optional(),
      })
      .optional(),
    camera: z.object({ purpose: z.string().trim().min(3).max(200) }).optional(),
    notify: z
      .object({ purpose: z.string().trim().min(3).max(200), daily: z.number().int().min(1).max(5).optional() })
      .optional(),
    runs: z
      .record(name, z.object({ label: z.string().trim().min(1).max(60), prompt: z.string().trim().min(3).max(2000) }))
      .refine((runs) => Object.keys(runs).length <= 8, 'At most 8 runs')
      .optional(),
    schedules: z
      .array(z.object({ run: name, every: z.enum(['hourly', 'daily', 'weekly']), at: time.optional() }))
      .max(4)
      .optional(),
    triggers: z
      .array(
        z.object({
          collection: name,
          when: z.object({
            field: name,
            op: z.enum(['>', '>=', '<', '<=', '=', '!=']),
            value: z.union([z.string().max(200), z.number(), z.boolean()]),
          }),
          run: name.optional(),
          notify: z.string().trim().max(200).optional(),
        }),
      )
      .max(8)
      .optional(),
    widget: z
      .object({
        title: z.string().trim().min(1).max(40),
        collection: name,
        kind: z.enum(['number', 'list']),
        sum: name.optional(),
        label: name.optional(),
      })
      .optional(),
    webhook: z.object({ collection: name }).optional(),
    folder: z
      .object({
        path: z
          .string()
          .min(1)
          .max(200)
          .refine(
            (path) => !path.startsWith('/') && !path.split('/').includes('..'),
            'Use a folder inside the project',
          ),
      })
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const runs = new Set(Object.keys(value.runs ?? {}))
    const collections = new Set(Object.keys(value.records ?? {}))
    for (const schedule of value.schedules ?? [])
      if (!runs.has(schedule.run))
        ctx.addIssue({ code: 'custom', message: `Schedule names unknown run ${schedule.run}` })
    for (const trigger of value.triggers ?? []) {
      if (!collections.has(trigger.collection))
        ctx.addIssue({ code: 'custom', message: `Trigger names unknown collection ${trigger.collection}` })
      if (trigger.run && !runs.has(trigger.run))
        ctx.addIssue({ code: 'custom', message: `Trigger names unknown run ${trigger.run}` })
      if (!trigger.run && !trigger.notify)
        ctx.addIssue({ code: 'custom', message: 'A trigger starts a run, sends a notification, or both' })
      if (trigger.notify && !value.notify)
        ctx.addIssue({ code: 'custom', message: 'Declare notify to send notifications from a trigger' })
    }
    for (const name of [value.widget?.collection, value.webhook?.collection])
      if (name && !collections.has(name)) ctx.addIssue({ code: 'custom', message: `Unknown collection ${name}` })
    if ((value.runs || value.schedules) && !value.ai)
      ctx.addIssue({ code: 'custom', message: 'Runs use a model; declare ai with its purpose' })
  })

const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/**
 * What a document declares it uses: ramu.json in a project, or a ramu-capabilities meta tag in a single file. A
 * declaration that does not validate fails preview, so a broken capability never reaches publication.
 */
export function pageCapabilitiesOf(input: Pick<InteractiveInput, 'html' | 'files'>): PageCapabilities {
  let raw: string | undefined
  const manifest = input.files?.find((file) => file.path === 'ramu.json')
  if (manifest) raw = manifest.content
  else {
    const source = input.html ?? input.files?.find((file) => file.path.endsWith('.html'))?.content ?? ''
    const tag = /<meta\s+name=["']ramu-capabilities["']\s+content=(?:"([^"]*)"|'([^']*)')\s*\/?>/i.exec(source)
    if (tag) raw = decode(tag[1] ?? tag[2] ?? '')
  }
  if (!raw?.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('ramu capabilities are not valid JSON.')
  }
  const result = pageCapabilitiesSchema.safeParse(parsed)
  if (!result.success)
    throw new Error(
      `ramu capabilities: ${result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'declaration'}: ${issue.message}`)
        .join('; ')}`,
    )
  return result.data as PageCapabilities
}
