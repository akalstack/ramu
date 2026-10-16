import { z } from 'zod'
import { skillInstallInput } from '../../memory/externalSkills'
import type { MemoryInput } from '@ramu/shared/types'
import { discoverSkills } from '../../context'
import { memoryInputSchema } from '../../memory/memory'
import { need } from '../helpers'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Memories, learned skills and the skill catalog. */
export const registerMemoryHandlers: RegisterHandlers = ({
  workspace,
  memory,
  learning,
  compression,
  managedSkills,
  externalSkills,
}) => ({
  'skills.availability': { args: z.tuple([]), run: () => need(externalSkills).availability() },
  'skills.find': {
    args: z.tuple([
      z
        .string()
        .trim()
        .min(1)
        .max(300)
        .refine((s) => !s.startsWith('-')),
    ]),
    run: (query: string) => need(externalSkills).find(query),
  },
  'skills.stage': {
    args: z.tuple([skillInstallInput]),
    run: (input: z.infer<typeof skillInstallInput>) => need(externalSkills).stage(input),
  },
  'skills.confirm': {
    args: z.tuple([id, z.boolean()]),
    run: (stageId: string, scripts: boolean) => need(externalSkills).confirm(stageId, scripts),
  },
  'skills.cancel': { args: z.tuple([id]), run: (stageId: string) => need(externalSkills).cancel(stageId) },
  'skills.updateSource': { args: z.tuple([id]), run: (skillId: string) => need(externalSkills).update(skillId) },
  'skills.remove': { args: z.tuple([id]), run: (skillId: string) => need(externalSkills).remove(skillId) },
  'skills.move': {
    args: z.tuple([id, id.nullable()]),
    run: (skillId: string, projectId: string | null) => need(externalSkills).move(skillId, projectId),
  },
  'skills.list': {
    args: z.tuple([id]),
    run: (ctx: string) => [
      ...new Map(
        [...managedSkills(ctx), ...discoverSkills(workspace.agentScope(ctx))].map((skill) => [skill.name, skill]),
      ).values(),
    ],
  },
  'learning.get': { args: z.tuple([]), run: () => need(learning).snapshot() },
  'learning.apply': { args: z.tuple([id]), run: (jobId: string) => need(learning).apply(jobId) },
  'learning.retry': { args: z.tuple([id]), run: (jobId: string) => need(learning).retry(jobId) },
  'learning.dismiss': { args: z.tuple([id]), run: (jobId: string) => need(learning).dismiss(jobId) },
  'learning.control': {
    args: z.tuple([id, z.enum(['pin', 'unpin', 'disable', 'archive', 'restore'])]),
    run: (skillId: string, action: 'pin' | 'unpin' | 'disable' | 'archive' | 'restore') =>
      need(learning).control(skillId, action),
  },
  'learning.history': { args: z.tuple([id]), run: (skillId: string) => need(learning).history(skillId) },
  'learning.revert': {
    args: z.tuple([id, z.number().int().positive()]),
    run: (skillId: string, revision: number) => need(learning).revert(skillId, revision),
  },
  'learning.run': { args: z.tuple([]), run: () => need(learning).tick(true) },
  'agent.compression': { args: z.tuple([id]), run: (sessionId: string) => need(compression).stats(sessionId) },
  'agent.checkpoint': { args: z.tuple([id]), run: (sessionId: string) => need(learning).checkpoint(sessionId) },
  'memory.revert': {
    args: z.tuple([id, z.number().int().min(0), z.number().int()]),
    run: (memoryId: string, index: number, updatedAt: number) => need(memory).revert(memoryId, index, updatedAt),
  },
  'memory.get': { args: z.tuple([]), run: () => need(memory).snapshot() },
  'memory.save': {
    args: z.tuple([memoryInputSchema, id.optional()]),
    run: (input: MemoryInput, memoryId?: string) => need(memory).save(input, { actor: 'user' }, memoryId).memory,
  },
  'memory.archive': {
    args: z.tuple([id]),
    run: (memoryId: string) => need(memory).archive(memoryId, { actor: 'user' }, 'archived by you'),
  },
  'memory.restore': { args: z.tuple([id]), run: (memoryId: string) => need(memory).restore(memoryId) },
  'memory.delete': { args: z.tuple([id]), run: (memoryId: string) => need(memory).delete(memoryId) },
  'memory.history': { args: z.tuple([id]), run: (memoryId: string) => need(memory).history(memoryId) },
  'memory.dream': { args: z.tuple([]), run: () => need(memory).dream() },
})
