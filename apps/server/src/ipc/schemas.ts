import { z } from 'zod'

/** Validation primitives shared by every handler group. */
export const id = z.string().min(1).max(100)
export const relPath = z.string().max(4096)
export const text = z.string().max(1_000_000)
/** A Git object id (SHA-1 or SHA-256), as a commit, stash or blob reference. */
export const gitOid = z.string().regex(/^[a-f0-9]{40,64}$/)
/** A SHA-256 fingerprint of staged or discardable changes. */
export const fingerprintHash = z.string().regex(/^[a-f0-9]{64}$/)
export const pullMode = z.enum(['rebase', 'merge', 'ff-only'])
export const providerId = z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'])

export const agentSettings = z.object({
  provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']),
  accountId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional(),
  model: z.string().max(200),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(),
  serviceTier: z.enum(['standard', 'fast']).default('standard'),
  access: z.enum(['edits', 'auto', 'full']),
  autoFallback: z.boolean(),
  /** Set only through `agent.setAutoResume`; accepted here so a settings object that carries it is not stripped. */
  autoResume: z.boolean().optional(),
})
/** A model setting for Ramu's own work: null is the setting's default, `use` names the default or the thread's model. */
/** One model and the login it runs on. */
export const workModel = z.object({
  provider: agentSettings.shape.provider,
  model: agentSettings.shape.model,
  effort: agentSettings.shape.effort,
  accountId: agentSettings.shape.accountId,
})
export const workModelChoice = z.union([z.object({ use: z.enum(['default', 'thread']) }), workModel]).nullable()

/** Files and selections the composer attaches to a prompt. */
export const fileContext = z
  .array(
    z.object({
      repoId: id,
      path: relPath,
      content: z.string().max(1000000).optional(),
      referenceOnly: z.boolean().optional(),
      selection: z
        .object({
          startLine: z.number().int().positive(),
          startColumn: z.number().int().positive(),
          endLine: z.number().int().positive(),
          endColumn: z.number().int().positive(),
          side: z.enum(['original', 'modified']).optional(),
        })
        .optional(),
      diff: z
        .object({
          staged: z.union([z.boolean(), z.literal('all')]),
          stash: z.boolean().optional(),
          oid: gitOid.optional(),
        })
        .optional(),
      source: z.enum(['tab', 'mention']),
    }),
  )
  .max(30)
  .optional()
export const attachmentIds = z.array(id).max(10).optional()

const viewerLabel = z.string().max(120)
/** The words the 3D viewer shows, from the reader's device. */
export const modelViewerLabels = z.object({
  triangles: viewerLabel,
  size: viewerLabel,
  animation: viewerLabel,
  still: viewerLabel,
  failed: viewerLabel,
})
