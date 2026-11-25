import { z } from 'zod'
import { skillInstallInput } from '../../memory/externalSkills'
import type { AgentProvider, MemoryInput } from '@ramu/shared/types'
import { discoverSkills } from '../../context'
import { memoryInputSchema } from '../../memory/memory'
import { need } from '../helpers'
import { id, providerId } from '../schemas'
import { SkillDirectory } from '../../memory/skillDirectory'

/** One directory per host, so its popular list is fetched once a day. */
const skillDirectory = new SkillDirectory()
import type { RegisterHandlers } from '../types'

/** Memories, learned skills and the skill catalog. */
export const registerMemoryHandlers: RegisterHandlers = ({
  workspace,
  memory,
  learning,
  managedSkills,
  externalSkills,
}) => ({
  'skills.availability': { args: z.tuple([]), run: () => need(externalSkills).availability() },
  'skills.search': {
    args: z.tuple([z.string().trim().min(2).max(100)]),
    run: (query: string) => skillDirectory.search(query),
  },
  'skills.popular': { args: z.tuple([]), run: () => skillDirectory.popular() },
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
  'skills.fileText': {
    args: z.tuple([z.union([z.object({ stageId: id }), z.object({ skillId: id })]), z.string().min(1).max(500)]),
    run: (ref: { stageId: string } | { skillId: string }, path: string) => need(externalSkills).fileText(ref, path),
  },
  'skills.confirm': {
    args: z.tuple([id, z.object({ projectId: id.nullable(), providers: z.array(providerId).min(1).max(5) })]),
    run: (stageId: string, options: { projectId: string | null; providers: AgentProvider[] }) =>
      need(externalSkills).confirm(stageId, options),
  },
  'skills.create': {
    args: z.tuple([
      z.object({
        name: z.string().min(1).max(64),
        description: z.string().min(1).max(4000),
        content: z.string().min(1).max(24_000),
        projectId: id.nullable(),
      }),
    ]),
    run: (input: { name: string; description: string; content: string; projectId: string | null }) =>
      need(externalSkills).create(input),
  },
  'skills.fork': {
    args: z.tuple([id, z.string().min(1).max(64).optional()]),
    run: (skillId: string, name?: string) => need(externalSkills).fork(skillId, name),
  },
  'skills.edit': {
    args: z.tuple([
      id,
      z.object({ description: z.string().max(4000).optional(), content: z.string().max(24_000).optional() }),
      z.number().int().nonnegative(),
    ]),
    run: (skillId: string, changes: { description?: string; content?: string }, revision: number) =>
      need(externalSkills).edit(skillId, changes, revision),
  },
  'skills.copyUpdate': { args: z.tuple([id]), run: (skillId: string) => need(externalSkills).copyUpdate(skillId) },
  'skills.applyCopyUpdate': {
    args: z.tuple([
      id,
      z.number().int().positive(),
      z.number().int().positive(),
      z.object({
        description: z.string().min(1).max(4000),
        content: z.string().min(1).max(24_000),
        files: z
          .record(z.string().max(500), z.enum(['copy', 'source']))
          .refine((files) => Object.keys(files).length <= 1001),
      }),
    ]),
    run: (
      skillId: string,
      revision: number,
      sourceRevision: number,
      changes: { description: string; content: string; files: Record<string, 'copy' | 'source'> },
    ) => need(externalSkills).applyCopyUpdate(skillId, revision, sourceRevision, changes),
  },
  'skills.cancel': { args: z.tuple([id]), run: (stageId: string) => need(externalSkills).cancel(stageId) },
  'skills.updateSource': { args: z.tuple([id]), run: (skillId: string) => need(externalSkills).update(skillId) },
  'skills.remove': { args: z.tuple([id]), run: (skillId: string) => need(externalSkills).remove(skillId) },
  'skills.move': {
    args: z.tuple([id, id.nullable()]),
    run: (skillId: string, projectId: string | null) => need(externalSkills).move(skillId, projectId),
  },
  'skills.setProviders': {
    args: z.tuple([id, z.array(providerId).min(1).max(5)]),
    run: (skillId: string, providers: AgentProvider[]) => need(learning).setProviders(skillId, providers),
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
  'learning.undo': { args: z.tuple([id]), run: (jobId: string) => need(learning).undo(jobId) },
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
  'agent.checkpoint': { args: z.tuple([id]), run: (sessionId: string) => need(learning).checkpoint(sessionId) },
  'agent.saveCheckpoint': {
    args: z.tuple([id, z.string().trim().min(1).max(6000)]),
    run: (sessionId: string, summary: string) => need(learning).editCheckpoint(sessionId, summary),
  },
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
