import { readFileSync, statSync } from 'node:fs'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'
import { z } from 'zod'
import type { AgentSettings, FileContext, PermissionScope, SecretAnswer } from '@ramu/shared/types'
import type { ModelViewerLabels } from '@ramu/shared/interactive'
import { INLINE_UI_LIMITS, type InlineUiActionEvent } from '@ramu/shared/chat/inlineUi'
import { MAX_VIDEO_BYTES, attachmentLimit } from '../../attachments'
import { ATTACHMENT_STREAM_PATH } from '../../attachmentStream'
import { modelViewerHtml } from '../../interactive/modelViewer'
import { draftPrompt, interpretDraft, type CustomAgent } from '@ramu/shared/customAgents'
import {
  chooseDuplicate,
  DUPLICATE_CHOICE_KEY,
  duplicateConnectionIds,
  type DuplicateChoices,
} from '../../mcp/duplicates'
import { projectSetupOf } from './projectSetup'
import { cursorArg, limitArg } from '../../paging'
import { PROVIDER_MANAGED_KEY, type ProviderManaged } from '../../agent/projectSetup'
import { buildSetupSnapshot, providerManagedServers } from '../../agent/effectiveSetup'
import {
  accountEnvironment,
  sharedSessionServers,
  sharedSessionSkills,
  SKILL_SHARING_KEY,
  type SkillSharing,
} from '../../agent/projectSetup'
import { lockCheckouts, lockSession } from '../helpers'
import { withMentionInstruction } from '../../agent/mentionContext'
import { agentSettings, attachmentIds, fileContext, id, modelViewerLabels, text } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Chat sessions: sending prompts, interrupting, answering questions and permissions, and attachments. */
/** An archived thread takes no new messages; it is unarchived first, which is what both apps offer instead. */
function assertOpen(workspace: { getTask(id: string): { status: string } }, taskId: string) {
  if (workspace.getTask(taskId).status === 'archived')
    throw new Error('This thread is archived. Unarchive it to continue.')
}

export const registerAgentHandlers: RegisterHandlers = (ctx) => {
  const { host, workspace, agents, attachmentStore, withContext, rules, getSharedMcp, environment } = ctx
  const mentionSources = {
    models: async () => (await agents.catalog()).flatMap((catalog) => catalog.models),
    agents: () => ctx.customAgents?.list() ?? [],
    abilities: async () => (ctx.abilities ? ctx.abilities.mentionModels() : {}),
  }
  return {
    'agent.all': { args: z.tuple([]), run: () => agents.all() },
    'agent.list': { args: z.tuple([id]), run: (taskId: string) => agents.list(taskId) },
    'agent.counts': { args: z.tuple([]), run: () => agents.counts() },
    'agent.get': { args: z.tuple([id]), run: (sessionId: string) => agents.get(sessionId) },
    'agent.goal': { args: z.tuple([id]), run: (s: string) => agents.getGoal(s) },
    'agent.markAdviceRead': { args: z.tuple([id]), run: (s: string) => agents.markAdviceRead(s) },
    'agent.goal.control': {
      args: z.tuple([id, z.enum(['pause', 'resume', 'clear'])]),
      run: (s: string, action: 'pause' | 'resume' | 'clear') => {
        // Resuming is the person continuing the thread, so a done thread reopens.
        if (action === 'resume') workspace.setDone(agents.get(s).taskId, false)
        return agents.controlGoal(s, action)
      },
    },
    // Only a person sets a verification command: Ramu runs it itself, so no agent tool reaches this.
    'agent.goal.verify': {
      args: z.tuple([id, z.string().max(2000).nullable()]),
      run: (s: string, command: string | null) => agents.setVerify(s, command),
    },
    // The person raises or lowers how many automatic turns this one goal may take, without changing Settings.
    'agent.goal.limit': {
      args: z.tuple([id, z.union([z.number().int().min(1).max(1000), z.null(), z.literal('default')])]),
      run: (s: string, limit: number | null | 'default') => agents.setGoalTurnLimit(s, limit),
    },
    'agent.changes': {
      args: z.tuple([
        id,
        z.number().int().min(0),
        z.number().int().min(0),
        z.boolean().optional(),
        z.number().int().min(0).optional(),
      ]),
      run: (sessionId: string, cursor: number, knownLastSeq: number, paged?: boolean, snapshotAfter?: number) =>
        agents.changes(sessionId, cursor, knownLastSeq, undefined, undefined, paged === true, snapshotAfter),
    },
    'agent.tail': { args: z.tuple([id]), run: (sessionId: string) => agents.tail(sessionId) },
    'agent.events': { args: z.tuple([id]), run: (sessionId: string) => agents.events(sessionId) },
    'agent.searchMessages': {
      args: z.tuple([z.string().max(200)]),
      run: (query: string) => agents.searchMessages(query),
    },
    'agent.searchMessagesPage': {
      args: z.tuple([z.string().max(200), cursorArg, limitArg]),
      run: (query: string, cursor: string | null, limit: number) => agents.searchMessagesPage(query, cursor, limit),
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
        const servers = sharedSessionServers(dirs, session.provider, env, { projectId })
        let duplicates = new Set<string>()
        try {
          if (projectId) duplicates = duplicateConnectionIds(projectSetupOf(ctx, projectId).setup, session.provider)
        } catch {
          // Unreadable project setup shows up in Settings; it must not hide the thread's own setup.
        }
        const skills = sharedSessionSkills(
          dirs,
          session.provider,
          env,
          workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {}),
          { projectId },
        )
        const connections = getSharedMcp?.().sessionConnections(session.provider, accountId, projectId) ?? []
        if (runtimeServers) {
          const seen = workspace.getAppState<ProviderManaged>(PROVIDER_MANAGED_KEY, {})
          const names = providerManagedServers({
            addedServers: servers.map((server) => server.name),
            connections,
            runtimeServers,
          }).map((server) => server.name)
          if (JSON.stringify(seen[session.provider] ?? []) !== JSON.stringify(names))
            workspace.setAppState(PROVIDER_MANAGED_KEY, { ...seen, [session.provider]: names })
        }
        return buildSetupSnapshot({
          sessionId,
          provider: session.provider,
          accountId,
          projectId,
          startedAt: session.createdAt,
          rules: rules?.list() ?? [],
          addedServers: servers.map((server) => server.name),
          changedSources: [
            ...servers.filter((server) => (server.changedAt ?? 0) > session.createdAt).map((s) => `server:${s.name}`),
            ...skills.filter((skill) => skill.changedAt > session.createdAt).map((s) => `skill:${s.name}`),
          ],
          ...(runtimeServers ? { runtimeServers } : {}),
          sharedSkills: skills.map((skill) => skill.name),
          skillTools: Object.fromEntries(skills.map((skill) => [skill.name, skill.tools])),
          connections,
          duplicates,
          hidden: workspace.getAppState<DuplicateChoices>(DUPLICATE_CHOICE_KEY, {})[sessionId] ?? [],
          now: Date.now(),
        })
      },
    },
    'agent.chooseDuplicate': {
      args: z.tuple([id, id, z.enum(['native', 'both'])]),
      run: (sessionId: string, connectionId: string, use: 'native' | 'both') => {
        agents.get(sessionId)
        workspace.setAppState(
          DUPLICATE_CHOICE_KEY,
          chooseDuplicate(
            workspace.getAppState<DuplicateChoices>(DUPLICATE_CHOICE_KEY, {}),
            sessionId,
            connectionId,
            use,
          ),
        )
      },
    },
    'agent.reloadMcp': { args: z.tuple([id]), run: (s: string) => agents.reloadMcp(s) },
    'agent.reconnectMcp': {
      args: z.tuple([id, z.string().min(1).max(500)]),
      run: (s: string, name: string) => agents.reconnectMcp(s, name),
    },
    'agent.signInMcp': {
      args: z.tuple([id, z.string().min(1).max(500)]),
      run: (s: string, name: string) => agents.signInMcp(s, name),
    },
    'agent.finishMcpSignIn': {
      args: z.tuple([id, z.string().min(1).max(500), z.string().url().max(8192)]),
      run: (s: string, name: string, callbackUrl: string) => agents.finishMcpSignIn(s, name, callbackUrl),
    },
    'agent.scope': { args: z.tuple([id]), run: (taskId: string) => workspace.agentScope(taskId) },
    'agent.catalog': { args: z.tuple([z.boolean().optional()]), run: (refresh?: boolean) => agents.catalog(refresh) },
    'models.news': { args: z.tuple([]), run: () => agents.modelNews?.notices() ?? [] },
    'models.dismissNews': {
      args: z.tuple([agentSettings.shape.provider, z.string().min(1).max(200)]),
      run: (provider: import('@ramu/shared/types').AgentProvider, model: string) =>
        agents.modelNews?.dismiss(provider, model),
    },
    'agent.configure': {
      args: z.tuple([id, agentSettings, z.literal('now').optional()]),
      run: (s: string, settings: AgentSettings, when?: 'now') =>
        lockSession(ctx, s, () => agents.configure(s, settings, when)),
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
          if (statSync(path).size > attachmentLimit(path))
            throw new Error(
              attachmentLimit(path) > 10 * 1024 * 1024
                ? 'A video or 3D model must be no larger than 100 MB.'
                : 'Each attachment must be no larger than 10 MB.',
            )
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
    // A file too large for one request (a phone's video) arrives in parts: begin, each part in order, then finish.
    'attachments.begin': {
      args: z.tuple([z.string().min(1).max(255), z.number().int().positive().max(MAX_VIDEO_BYTES)]),
      run: (name: string, size: number) => attachmentStore.beginUpload(name, size),
    },
    'attachments.part': {
      args: z.tuple([
        id,
        z.number().int().nonnegative().max(10_000),
        z
          .string()
          .min(1)
          .max(6_000_000)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      ]),
      run: (token: string, index: number, base64: string) =>
        attachmentStore.appendUpload(token, index, Buffer.from(base64, 'base64')),
    },
    'attachments.finish': { args: z.tuple([id]), run: (token: string) => attachmentStore.finishUpload(token) },
    // A single-file address a player streams a video or audio attachment from; the loopback one serves this computer.
    'attachments.stream': {
      args: z.tuple([id]),
      run: (attachmentId: string) => {
        const path = `${ATTACHMENT_STREAM_PATH}${attachmentStore.streamToken(attachmentId)}`
        const port = host.loopbackPort?.()
        return { path, ...(port ? { local: `http://127.0.0.1:${port}${path}` } : {}) }
      },
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
    'attachments.modelViewer': {
      args: z.tuple([id, modelViewerLabels]),
      run: (attachmentId: string, labels: ModelViewerLabels) =>
        modelViewerHtml(attachmentStore.model(attachmentId), labels),
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
        assertOpen(workspace, taskId)
        if (settings) await agents.validateSettings(settings)
        prompt = await withMentionInstruction(await withContext(workspace, taskId, prompt, context), mentionSources)
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
        assertOpen(workspace, taskId)
        workspace.setDone(taskId, false)
        t = await withContext(workspace, taskId, t, context)
        if (!agents.get(s).parentId) t = await withMentionInstruction(t, mentionSources)
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
    'agent.holdQueued': {
      args: z.tuple([id, id, z.boolean()]),
      run: (s: string, messageId: string, held: boolean) => agents.holdQueued(s, messageId, held),
    },
    'agent.editQueued': {
      args: z.tuple([id, id, text]),
      run: (s: string, messageId: string, t: string) => agents.editQueued(s, messageId, t),
    },
    'agent.reorderQueued': {
      args: z.tuple([id, z.array(id).max(1000)]),
      run: (s: string, order: string[]) => lockSession(ctx, s, async () => agents.reorderQueued(s, order)),
    },
    'agent.send': {
      args: z.tuple([id, text]),
      run: (s: string, t: string) => {
        assertOpen(workspace, agents.get(s).taskId)
        workspace.setDone(agents.get(s).taskId, false)
        return lockSession(ctx, s, () => agents.send(s, t))
      },
    },
    'agent.resumeQueue': {
      args: z.tuple([id]),
      run: (s: string) => {
        workspace.setDone(agents.get(s).taskId, false)
        return agents.resumeQueue(s)
      },
    },
    'agent.sendQueuedNow': {
      args: z.tuple([id, id, z.boolean().optional()]),
      run: (s: string, messageId: string, interrupt?: boolean) => {
        assertOpen(workspace, agents.get(s).taskId)
        workspace.setDone(agents.get(s).taskId, false)
        return lockSession(ctx, s, () => agents.sendQueuedNow(s, messageId, interrupt))
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
    'agent.startRoute': {
      args: z.tuple([agentSettings]),
      run: async (settings: AgentSettings) => {
        const route = await agents.route(settings)
        return route ? { settings: agents.withStep(settings, route.step), reason: route.reason } : null
      },
    },
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
        lockSession(ctx, s, () => agents.messageFromPerson(s, agentId, text)),
    },
    'customAgents.list': { args: z.tuple([]), run: () => ctx.customAgents?.list() ?? [] },
    'customAgents.save': {
      args: z.tuple([
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().trim().min(1).max(60),
          description: z.string().trim().min(1).max(300),
          instructions: z.string().trim().min(1).max(8000),
          model: z
            .object({
              provider: agentSettings.shape.provider,
              model: z.string().max(200),
              effort: agentSettings.shape.effort,
            })
            .nullable(),
          readOnly: z.boolean(),
        }),
      ]),
      run: (input: Omit<CustomAgent, 'id' | 'updatedAt'> & { id?: string }) => {
        if (!ctx.customAgents) throw new Error('Custom agents are unavailable on this host.')
        return ctx.customAgents.save(input)
      },
    },
    'customAgents.delete': {
      args: z.tuple([z.string().uuid()]),
      run: (agentId: string) => ctx.customAgents?.remove(agentId),
    },
    'customAgents.draft': {
      args: z.tuple([z.string().trim().min(3).max(2000), agentSettings]),
      run: async (sentence: string, settings: AgentSettings) => {
        // One bounded, tool-free call drafts it; the person edits before anything is saved.
        const { message } = await agents.analyze(draftPrompt(sentence), settings, 12_000, { timeoutMs: 60_000 })
        const draft = interpretDraft(message)
        if (!draft) throw new Error('That did not produce a usable draft. Try describing it another way.')
        return draft
      },
    },
    'agent.replyPermission': {
      args: z.tuple([
        id,
        id,
        z.boolean(),
        z.string().max(10_000).nullish(),
        z.enum(['once', 'thread', 'project', 'user']).optional(),
        z.string().max(300).optional(),
      ]),
      run: (s: string, r: string, allow: boolean, message?: string | null, scope?: PermissionScope, pattern?: string) =>
        agents.replyPermission(s, r, allow, message ?? undefined, scope, pattern),
    },
    'agent.forgetPermission': {
      args: z.tuple([id, id, z.enum(['project', 'user'])]),
      run: (s: string, r: string, scope: 'project' | 'user') => agents.forgetPermission(s, r, scope),
    },
    // Owner devices only: it names a host folder. A viewer can still approve the location the card shows.
    'agent.createProjectIn': {
      args: z.tuple([id, z.string().min(1).max(300), z.string().min(1).max(4096)]),
      run: async (s: string, r: string, parent: string) => {
        const folder = await ctx.hostFolders.inspect(parent)
        agents.createProjectIn(s, r, folder)
      },
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
    // Owner devices only: a press starts the agent's turn, as sending a message does.
    'agent.inlineUiAction': {
      args: z.tuple([
        id,
        z
          .object({
            name: z.string().min(1).max(100),
            surfaceId: z.string().min(1).max(100),
            sourceComponentId: z.string().min(1).max(100),
            timestamp: z.string().max(40),
            context: z.record(z.string().max(100), z.unknown()),
            userMessage: z.string().max(500).optional(),
            dataModel: z.record(z.string().max(200), z.unknown()).optional(),
          })
          .strict()
          .refine(
            (action) => JSON.stringify(action).length <= INLINE_UI_LIMITS.modelBytes * 2,
            'The card sent too much.',
          ),
      ]),
      run: (s: string, action: InlineUiActionEvent) => {
        assertOpen(workspace, agents.get(s).taskId)
        workspace.setDone(agents.get(s).taskId, false)
        return lockSession(ctx, s, () => agents.inlineUiAction(s, action))
      },
    },
    'agent.dismissQuestion': {
      args: z.tuple([id, z.string().min(1).max(300)]),
      run: (s: string, r: string) => agents.closeQuestion(s, r, 'dismissed'),
    },
    // Owner devices only (absent from the viewer allowlist). The value is never logged or recorded in the thread.
    'agent.answerSecret': {
      args: z.tuple([
        id,
        z.string().min(1).max(300),
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('save'),
            secret: z
              .string()
              .max(64 * 1024)
              .refine((value) => value.trim().length > 0),
            remember: z.boolean().optional(),
          }),
          z.object({ type: z.literal('decline') }),
        ]),
      ]),
      run: async (s: string, r: string, answer: SecretAnswer) => {
        const request = agents.pendingSecret(s, r)
        if (answer.type === 'decline') return agents.answerSecret(s, r, null)
        const secret = answer.secret.trim()
        let savedAs: string | undefined
        if (answer.remember) {
          if (!request.envName) throw new Error('This request has no environment variable to keep.')
          // Like API keys, kept variables are entered only on the host running Ramu.
          if (host.canAdministerIntegrations?.() !== true) throw new Error(ADMINISTER_REFUSAL)
          const status = environment.status(true)
          if (status.state === 'unavailable')
            throw new Error('The host credential store is locked. Unlock it and try again.')
          const current = status.values ?? {}
          await environment.save({
            ...current,
            global: [
              ...(current.global ?? []).filter((entry) => entry.key !== request.envName),
              { key: request.envName, value: secret },
            ],
          })
          savedAs = request.envName
        }
        return agents.answerSecret(s, r, { secret, ...(savedAs ? { savedAs } : {}) })
      },
    },
  }
}
