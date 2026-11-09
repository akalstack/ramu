import { z } from 'zod'
import {
  RULE_BODY_LIMIT,
  RULE_NAME_LIMIT,
  RULE_PATH_LIMIT,
  RULE_PATTERN_LIMIT,
  type RuleInput,
} from '@ramu/shared/types'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import { id } from '../schemas'
import { need } from '../helpers'
import { inspectNativeInstructions } from '../../rules/nativeInstructions'
import type { RegisterHandlers } from '../types'

const ruleInput = z.object({
  id: id.optional(),
  baseRevision: z.number().int().positive().optional(),
  name: z.string().max(RULE_NAME_LIMIT * 2),
  body: z.string().max(RULE_BODY_LIMIT * 2),
  projectId: id.nullable(),
  providers: z.array(z.enum(AGENT_PROVIDERS)).max(AGENT_PROVIDERS.length),
  activation: z.enum(['always', 'manual', 'paths']),
  // Loose bounds here; the store refuses anything past the real limits with a sentence the editor can show.
  paths: z.array(z.string().max(RULE_PATTERN_LIMIT * 2)).max(RULE_PATH_LIMIT * 2),
  enabled: z.boolean(),
})

/** Shared user rules: text instructions with revisions. They never grant a permission. */
export const registerRuleHandlers: RegisterHandlers = ({ rules, ruleFiles, host, workspace }) => {
  const changed = () => {
    ruleFiles?.sync()
    host.send('rules:changed', {})
  }
  return {
    'rules.native': {
      args: z.tuple([id.nullable()]),
      run: (projectId: string | null) => {
        if (projectId === null) return inspectNativeInstructions(null, [])
        const project = workspace.listProjects().find((entry) => entry.id === projectId)
        if (!project) throw new Error('Unknown project.')
        const roots = workspace.listRepositories(projectId).map((repo) => ({ label: repo.name, path: repo.root }))
        if (project.root && !roots.some((root) => root.path === project.root))
          roots.unshift({ label: project.name, path: project.root })
        return inspectNativeInstructions(projectId, roots)
      },
    },
    'rules.list': { args: z.tuple([]), run: () => need(rules).list() },
    'rules.files': { args: z.tuple([]), run: () => need(ruleFiles).status() },
    'rules.save': {
      args: z.tuple([ruleInput]),
      run: (input: RuleInput) => {
        const saved = need(rules).save(input)
        changed()
        return saved
      },
    },
    'rules.remove': {
      args: z.tuple([id]),
      run: (ruleId: string) => {
        need(rules).remove(ruleId)
        changed()
      },
    },
    'rules.history': { args: z.tuple([id]), run: (ruleId: string) => need(rules).history(ruleId) },
    'rules.restore': {
      args: z.tuple([id, z.number().int().positive()]),
      run: (ruleId: string, revision: number) => {
        const saved = need(rules).restore(ruleId, revision)
        changed()
        return saved
      },
    },
  }
}
