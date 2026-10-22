import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import type { AgentSettings, FileContext, PermissionScope } from '@ramu/shared/types'
import { MAX_ATTACHMENT_BYTES } from '../../attachments'
import { buildSetupSnapshot } from '../../agent/effectiveSetup'
import {
  accountEnvironment,
  sharedSessionServers,
  sharedSessionSkills,
  SKILL_SHARING_KEY,
  type SkillSharing,
} from '../../agent/projectSetup'
import { lockCheckouts, lockSession } from '../helpers'
import { agentSettings, attachmentIds, fileContext, id, text } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Chat sessions: sending prompts, interrupting, answering questions and permissions, and attachments. */
export const registerAgentHandlers: RegisterHandlers = (ctx) => {
  const { host, workspace, agents, attachmentStore, withContext, rules, getSharedMcp } = ctx
  return {
    'agent.all': { args: z.tuple([]), run: () => agents.all() },
    'agent.list': { args: z.tuple([id]), run: (taskId: string) => agents.list(taskId) },
    'agent.counts': { args: z.tuple([]), run: () => agents.counts() },
    'agent.get': { args: z.tuple([id]), run: (sessionId: string) => agents.get(sessionId) },
    'agent.goal': { args: z.tuple([id]), run: (s: string) => agents.getGoal(s) },
    'agent.goal.control': {
      args: z.tuple([id, z.enum(['pause', 'resume', 'clear'])]),
      run: (s: string, action: 'pause' | 'resume' | 'clear') => agents.controlGoal(s, action),
    },
    // Only a person sets a verification command: Ramu runs it itself, so no agent tool reaches this.
    'agent.goal.verify': {
      args: z.tuple([id, z.string().max(2000).nullable()]),
      run: (s: string, command: string | null) => agents.setVerify(s, command),
    },
    'agent.snapshot': { args: z.tuple([id]), run: (sessionId: string) => agents.snapshot(sessionId) },
    'agent.changes': {
      args: z.tuple([id, z.number().int().min(0), z.number().int().min(0)]),
      run: (sessionId: string, cursor: number, knownLastSeq: number) => agents.changes(sessionId, cursor, knownLastSeq),
    },
    'agent.events': { args: z.tuple([id]), run: (sessionId: string) => agents.events(sessionId) },
    'agent.searchMessages': {
      args: z.tuple([z.string().max(200)]),
      run: (query: string) => agents.searchMessages(query),
    },
    'agent.mcpStatus': { args: z.tuple([id]), run: (s: string) => agents.mcpStatus(s) },
    /** What this thread has from Ramu's agent setup, from the resolvers a launch uses. Names and states only. */
    'agent.setup': {
      args: z.tuple([id]),
      run: async (sessionId: string) => {
        const session = agents.get(sessionId)
        let projectId: string | null = null
        try {
          projectId = workspace.getTask(session.taskId).projectId
        } catch {
          // A thread outside a project resolves host-wide setup only.
        }
        const accountId = session.settings.accountId ?? 'default'
        const dirs = [...new Set([session.cwd, ...session.additionalDirs, ...session.covers])]
        const env = accountEnvironment(session.provider, accountId)
        let runtimeServers: { name: string; status: string }[] | undefined
        try {
          const status = await agents.mcpStatus(sessionId)
          if (status.live) runtimeServers = status.servers
        } catch {
          // The runtime could not be asked; its servers stay unconfirmed.
        }
        return buildSetupSnapshot({
          sessionId,
          provider: session.provider,
          accountId,
          projectId,
          startedAt: session.createdAt,
          rules: rules?.list() ?? [],
          addedServers: sharedSessionServers(dirs, session.provider, env, { projectId }).map((server) => server.name),
          ...(runtimeServers ? { runtimeServers } : {}),
          sharedSkills: sharedSessionSkills(
            dirs,
            session.provider,
            env,
            workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {}),
            { projectId },
          ).map((skill) => skill.name),
          connections: getSharedMcp?.().sessionConnections(session.provider, accountId, projectId) ?? [],
          now: Date.now(),
        })
      },
    },
    'agent.reloadMcp': { args: z.tuple([id]), run: (s: string) => agents.reloadMcp(s) },
    'agent.reconnectMcp': {
      args: z.tuple([id, z.string().min(1).max(500)]),
      run: (s: string, name: string) => agents.reconnectMcp(s, name),
    },
    'agent.scope': { args: z.tuple([id]), run: (taskId: string) => workspace.agentScope(taskId) },
    'agent.catalog': { args: z.tuple([z.boolean().optional()]), run: (refresh?: boolean) => agents.catalog(refresh) },
    'agent.configure': {
      args: z.tuple([id, agentSettings]),
      run: (s: string, settings: AgentSettings) => lockSession(ctx, s, () => agents.configure(s, settings)),
    },
    'agent.retryLimitNow': {
      args: z.tuple([id]),
      run: (s: string) => agents.retryLimitNow(s),
    },
    'agent.setAutoResume': {
      args: z.tuple([id, z.boolean().nullable()]),
      run: (s: string, value: boolean | null) => agents.setAutoResume(s, value),
    },
    'attachments.pick': {
      args: z.tuple([]),
      run: async () => {
        const filePaths = (await host.native('pickAttachments')) as string[]
        if (filePaths.length > 10) throw new Error('Attach up to 10 files per message.')
        for (const path of filePaths)
          if (statSync(path).size > MAX_ATTACHMENT_BYTES)
            throw new Error('Each attachment must be no larger than 10 MB.')
        return filePaths.map((path) => attachmentStore.add(path, readFileSync(path)))
      },
    },
    'attachments.add': {
      args: z.tuple([
        z.string().min(1).max(255),
        z
          .string()
          .min(1)
          .max(14_000_000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      ]),
      run: (name: string, base64: string) => attachmentStore.add(name, Buffer.from(base64, 'base64')),
    },
    'attachments.status': {
      args: z.tuple([z.array(id).max(10)]),
      run: (ids: string[]) => attachmentStore.status(ids),
    },
    'attachments.text': { args: z.tuple([id]), run: (attachmentId: string) => attachmentStore.text(attachmentId) },
    'attachments.preview': {
      args: z.tuple([id]),
      run: (attachmentId: string) => attachmentStore.preview(attachmentId),
    },
    'agent.start': {
      args: z.tuple([id, z.string().max(1_000_000), agentSettings.optional(), attachmentIds, fileContext]),
      run: async (
        taskId: string,
        prompt: string,
        settings?: AgentSettings,
        attachmentIds?: string[],
        context?: FileContext[],
      ) => {
        if (taskId.startsWith('project:') || taskId.startsWith('worktree:'))
          throw new Error('Start a thread to run the agent.')
        if (settings) await agents.validateSettings(settings)
        prompt = await withContext(workspace, taskId, prompt, context)
        const scope = workspace.agentScope(taskId)
        return lockCheckouts(ctx, scope.covers, () => {
          workspace.getTask(taskId)
          ctx.terminals?.assertTaskAvailable(taskId)
          return agents.startReviewed(taskId, scope, prompt, settings, attachmentStore.resolve(attachmentIds))
        })
      },
    },
    'agent.submit': {
      args: z.tuple([id, z.string().max(1_000_000), z.enum(['queue', 'steer']), attachmentIds, fileContext]),
      run: async (s: string, t: string, mode: 'queue' | 'steer', attachmentIds?: string[], context?: FileContext[]) => {
        const taskId = agents.get(s).taskId
        workspace.setDone(taskId, false)
        t = await withContext(workspace, taskId, t, context)
        return lockSession(ctx, s, () => {
          workspace.getTask(taskId)
          ctx.terminals?.assertTaskAvailable(taskId)
          return agents.submit(s, t, mode, attachmentStore.resolve(attachmentIds), undefined, true)
        })
      },
    },
    'agent.removeQueued': {
      args: z.tuple([id, id]),
      run: (s: string, messageId: string) => agents.removeQueued(s, messageId),
    },
    'agent.reorderQueued': {
      args: z.tuple([id, z.array(id).max(1000)]),
      run: (s: string, order: string[]) => lockSession(ctx, s, async () => agents.reorderQueued(s, order)),
    },
    'agent.send': {
      args: z.tuple([id, text]),
      run: (s: string, t: string) => {
        workspace.setDone(agents.get(s).taskId, false)
        return lockSession(ctx, s, () => agents.send(s, t))
      },
    },
    'agent.resumeQueue': { args: z.tuple([id]), run: (s: string) => agents.resumeQueue(s) },
    'agent.sendQueuedNow': {
      args: z.tuple([id, id]),
      run: (s: string, messageId: string) => {
        workspace.setDone(agents.get(s).taskId, false)
        return lockSession(ctx, s, () => agents.sendQueuedNow(s, messageId))
      },
    },
    'agent.continuationPrompt': { args: z.tuple([id]), run: (s: string) => agents.continuationPrompt(s) },
    'agent.interrupt': {
      args: z.tuple([id]),
      run: (s: string) => {
        ctx.pullRequestWatches?.stopForSession(s)
        return agents.interrupt(s)
      },
    },
    'agent.stop': {
      args: z.tuple([id]),
      run: (s: string) => {
        ctx.pullRequestWatches?.stopForSession(s)
        return agents.stopAndWait(s)
      },
    },
    'agent.rewind': {
      args: z.tuple([id, z.number().int().positive()]),
      run: (s: string, userSeq: number) => lockSession(ctx, s, () => agents.rewind(s, userSeq)),
    },
    'agent.context': { args: z.tuple([id]), run: (s: string) => agents.context(s) },
    'agent.holdProvider': {
      args: z.tuple([id, z.enum(['message', 'chat']).nullable()]),
      run: (s: string, scope: 'message' | 'chat' | null) => agents.holdProvider(s, scope),
    },
    'agent.providerHold': { args: z.tuple([id]), run: (s: string) => agents.providerHold(s) },
    'agent.nextRoute': { args: z.tuple([id]), run: (s: string) => agents.nextRoute(s) },
    'agent.backgroundTool': {
      args: z.tuple([id, z.string().min(1).max(300)]),
      run: (s: string, toolUseId: string) => agents.backgroundTool(s, toolUseId),
    },
    'agent.stopTask': {
      args: z.tuple([id, z.string().min(1).max(200)]),
      run: (s: string, agentId: string) => agents.stopTask(s, agentId),
    },
    'agent.messageTask': {
      args: z.tuple([id, z.string().min(1).max(200), z.string().min(1).max(100_000)]),
      run: (s: string, agentId: string, text: string) =>
        lockSession(ctx, s, () => agents.messageTask(s, agentId, text)),
    },
    'agent.replyPermission': {
      args: z.tuple([
        id,
        id,
        z.boolean(),
        z.string().max(10_000).nullish(),
        z.enum(['once', 'project', 'user']).optional(),
        z.string().max(300).optional(),
      ]),
      run: (s: string, r: string, allow: boolean, message?: string | null, scope?: PermissionScope, pattern?: string) =>
        agents.replyPermission(s, r, allow, message ?? undefined, scope, pattern),
    },
    'agent.forgetPermission': {
      args: z.tuple([id, id, z.enum(['project', 'user'])]),
      run: (s: string, r: string, scope: 'project' | 'user') => agents.forgetPermission(s, r, scope),
    },
    'agent.replyQuestion': {
      args: z.tuple([id, z.string().min(1).max(300), z.record(z.string().max(10_000), z.string().max(10_000))]),
      run: (s: string, r: string, answers: Record<string, string>) => agents.replyQuestion(s, r, answers),
    },
    'agent.replyElicitation': {
      args: z.tuple([
        id,
        z.string().min(1).max(300),
        z.enum(['accept', 'decline', 'cancel']),
        z.record(z.string().max(10000), z.string().max(10000)),
      ]),
      run: (s: string, r: string, action: 'accept' | 'decline' | 'cancel', answers: Record<string, string>) =>
        agents.replyElicitation(s, r, action, answers),
    },
    'agent.elicitationDraft': {
      args: z.tuple([id, z.string().min(1).max(300), z.record(z.string().max(10000), z.string().max(10000))]),
      run: (s: string, r: string, drafts: Record<string, string>) => agents.saveElicitationDraft(s, r, drafts),
    },
    'agent.questionDraft': {
      args: z.tuple([id, z.string().min(1).max(300), z.record(z.string().max(10000), z.string().max(10000))]),
      run: (s: string, r: string, drafts: Record<string, string>) => agents.saveQuestionDraft(s, r, drafts),
    },
    'agent.dismissQuestion': {
      args: z.tuple([id, z.string().min(1).max(300)]),
      run: (s: string, r: string) => agents.closeQuestion(s, r, 'dismissed'),
    },
  }
}
