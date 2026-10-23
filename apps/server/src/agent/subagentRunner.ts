import { selectSubagentSettings } from './subagentSelection'
import type { BackgroundAnalysis } from './backgroundAnalysis'
import { capSubagentEffort } from '@ramu/shared/providers/routing'
import { forwardedRequestId } from './childRequests'
import { clipText } from '@ramu/shared/text'
import { providerName } from '@ramu/shared/providers/providers'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type {
  FallbackStep,
  AppPreferences,
  AgentTask,
  AgentTaskStatus,
  AgentEvent,
  AgentSessionInfo,
  AgentSessionState,
  ProviderCatalog,
} from '@ramu/shared/types'
import { subagentTarget, settingsKey, accountKey, nextStep } from '@ramu/shared/providers/routing'
import { SUBAGENT_PREAMBLE, subagentNotePrompt, taskReportPrompt } from '@ramu/shared/chat/agentTasks'
import { applyIsolation, collectPatch, createIsolation, removeIsolation } from '../workspace/isolation'
import type { ChildRun, SubagentInput, SubagentResult } from './types'
import { FOREGROUND_WAIT_MS, ASK_WAIT_MS } from './constants'
import { str, errorMessage } from './util'
import { transcriptOf } from './handoff'
import type { CatalogService } from './catalogService'
import type { MessageDispatcher } from './messageDispatcher'
import type { SessionProcess } from './sessionProcess'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { UserRequests } from './userRequests'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStore } from './sessionStore'
import type { AgentTasks } from './agentTasks'
import type { ProviderWaits } from './providerWait'
import type { AgentService } from '../agent'

/** What SubagentRunner needs from the rest of the service. */
export interface SubagentRunnerHost
  extends
    Pick<BackgroundAnalysis, 'analyze'>,
    Pick<CatalogService, 'validateSettings'>,
    Pick<MessageDispatcher, 'submit'>,
    Pick<SessionProcess, 'launch' | 'stop'>,
    Pick<SessionRecorder, 'record'>,
    Pick<SessionRegistry, 'revisions' | 'transitioning'>,
    Pick<UserRequests, 'childRequests'>,
    Pick<
      FallbackRouter,
      'attempted' | 'policyOf' | 'routing' | 'subagentSettings' | 'withStep' | 'otherAccount' | 'freshAccountUsage'
    >,
    Pick<ProviderWaits, 'autoResumeOf' | 'providerWait'>,
    Pick<SessionStore, 'createSession' | 'events' | 'get' | 'task'>,
    Pick<AgentTasks, 'updateTask'> {
  catalog(refresh?: boolean): Promise<ProviderCatalog[]>
  isolationRoot(): AgentService['isolationRoot']
  helperSetupNote(): AgentService['helperSetupNote']
  preferences(): AppPreferences | undefined
  shutdown(): AgentService['shutdown']
}

/** Sub-agents Ramu runs as sessions of their own: spawning, reporting back, mirroring into the parent chat, and redirecting native sub-agent tools. */
export class SubagentRunner {
  constructor(private readonly host: SubagentRunnerHost) {}

  /** Sub-agents Ramu runs as sessions of their own, by child session id. */
  readonly children = new Map<string, ChildRun>()

  /** Native sub-agents already picked up again after a limit, so one is not continued twice. */
  private readonly continued = new Set<string>()

  /** The sub-agent's run ended: record its report and hand it to whoever is waiting, or message its chat. */
  settleChild(id: string): void {
    const run = this.children.get(id)
    if (!run || run.settled || this.host.transitioning.has(id)) return
    const state = this.host.get(id).state
    if (state !== 'idle' && state !== 'failed' && state !== 'stopped') return
    // A helper held at a usage limit is neither done nor failed: it waits with its login and the chat keeps it as running.
    // With auto-resume off nothing will continue it, so it ends as stopped with the reason, and never as failed.
    const held = !!this.host.providerWait(id)
    if (held && this.host.autoResumeOf(id)) {
      this.host.updateTask(run.parentId, id, {
        summary: 'Limit reached · resumes automatically',
        waitingFor: 'provider',
      })
      return
    }
    if (held) run.lastText ||= 'Stopped at a usage limit. Auto-resume is off for this thread.'
    run.settled = true
    run.asking?.('The sub-agent ended before an answer arrived.')
    const status: AgentTaskStatus = held
      ? 'stopped'
      : state === 'idle'
        ? 'completed'
        : state === 'failed'
          ? 'failed'
          : 'stopped'
    const error = this.host.events(id).findLast((e) => e.kind === 'error')
    const failure = error?.kind === 'error' ? error.message : ''
    const report = run.lastText || failure || (status === 'stopped' ? 'Stopped before it finished.' : '')
    const finish = (note: string) => {
      const text = `${report}${note}`
      this.host.updateTask(run.parentId, id, {
        status,
        summary: text || undefined,
        endedAt: Date.now(),
        ...(status === 'failed' ? { error: failure || 'The sub-agent failed.' } : {}),
        ...(run.isolation ? { canMessage: false } : {}),
      })
      const result: SubagentResult = {
        agentId: id,
        name: run.name,
        status,
        report: text || 'It left no report.',
        provider: this.host.get(id).provider,
        model: this.host.get(id).settings.model,
      }
      if (run.waiter) {
        const waiter = run.waiter
        run.waiter = undefined
        waiter(result)
        return
      }
      if (run.report) void this.reportToParent(run.parentId, taskReportPrompt(run.name, status, result.report))
    }
    // The task stays "running" in its chat until the work is back in the checkout, so the checkout stays reserved and the change capture waits.
    if (run.isolation)
      void this.finishIsolation(run, status).then(finish, (error) =>
        finish(`\n\n(Bringing its changes back failed: ${errorMessage(error)})`),
      )
    else finish('')
  }

  private readonly pendingStarts = new Map<symbol, string>()
  private readonly cancelledStarts = new Set<symbol>()

  /** Stopping a thread cancels the sub-agents it was still choosing a model for, even when the thread itself had finished. */
  cancelPendingStarts(parentId: string): void {
    for (const [reservation, id] of this.pendingStarts) if (id === parentId) this.cancelledStarts.add(reservation)
  }

  async spawnSubagent(
    parentId: string,
    input: SubagentInput,
    signal?: AbortSignal,
    forced?: { step: FallbackStep; reason: string },
  ): Promise<SubagentResult> {
    const cap = this.host.preferences()?.subagents.maxConcurrent ?? 3
    const active = [...this.children.values()].filter((run) => run.parentId === parentId && !run.settled).length
    const pending = [...this.pendingStarts.values()].filter((id) => id === parentId).length
    if (active + pending >= cap)
      throw new Error(`${cap} sub-agents are already running. Wait for one to finish, then try again.`)
    const reservation = Symbol()
    this.pendingStarts.set(reservation, parentId)
    try {
      return await this.startSubagent(parentId, input, signal, forced, reservation)
    } finally {
      this.pendingStarts.delete(reservation)
      this.cancelledStarts.delete(reservation)
    }
  }

  /** Starts a sub-agent as a session of its own on the provider and model routing picks. Foreground waits for its report. */
  private async startSubagent(
    parentId: string,
    input: SubagentInput,
    signal: AbortSignal | undefined,
    forced: { step: FallbackStep; reason: string } | undefined,
    reservation: symbol,
  ): Promise<SubagentResult> {
    const parent = this.host.get(parentId)
    // Stopping the parent bumps this, even when it was idle and so stays idle: a start that began earlier is then stale.
    const parentRevision = this.host.revisions.get(parentId) ?? 0
    if (parent.parentId) throw new Error('A sub-agent cannot start sub-agents through Ramu. Use your own tools.')
    if (this.host.shutdown() || !['running', 'starting', 'idle', 'needs-input'].includes(parent.state))
      throw new Error('This thread is not running.')
    const cap = this.host.preferences()?.subagents.maxConcurrent ?? 3
    if ([...this.children.values()].filter((run) => run.parentId === parentId && !run.settled).length >= cap)
      throw new Error(`${cap} sub-agents are already running. Wait for one to finish, then try again.`)
    const target = forced
      ? {
          settings: { ...this.host.withStep(parent.settings, forced.step), autoFallback: parent.settings.autoFallback },
          reason: forced.reason,
          from: parent.provider,
        }
      : await this.host.subagentSettings(parentId, input.type)
    const catalogs = await this.host.catalog()
    const selectionPrefs = this.host.preferences()?.subagents
    if (selectionPrefs) {
      if (
        target.settings.provider !== parent.provider &&
        selectionPrefs.autoSelect &&
        selectionPrefs.autoSelect !== 'off'
      ) {
        const selection = await selectSubagentSettings(
          target.settings,
          selectionPrefs,
          catalogs,
          `${input.description}\n${input.prompt}`,
          (...args) => this.host.analyze(...args),
          signal,
        )
        target.settings = selection.settings
        target.reason = [target.reason, selection.note].filter(Boolean).join('; ')
      } else target.settings = capSubagentEffort(target.settings, selectionPrefs, catalogs)
    }
    if (
      signal?.aborted ||
      this.cancelledStarts.has(reservation) ||
      this.host.shutdown() ||
      this.host.get(parentId).state === 'stopped' ||
      parentRevision !== (this.host.revisions.get(parentId) ?? 0)
    )
      throw new Error('Sub-agent start was cancelled.')
    await this.host.validateSettings(target.settings)
    const name = clipText(input.name?.trim() || input.description.trim() || 'Sub-agent', 80)
    // Its own copy of the checkout, when asked for: parallel helpers never overwrite each other or the chat.
    const isolationRoot = this.host.isolationRoot()
    const isolation =
      this.host.preferences()?.subagents.isolate && isolationRoot
        ? await createIsolation({
            cwd: parent.cwd,
            covers: parent.covers,
            root: join(isolationRoot, randomUUID()),
          })
        : null
    const child = this.host.createSession(
      parent.taskId,
      isolation
        ? { cwd: isolation.cwd, additionalDirs: isolation.additionalDirs, covers: isolation.covers }
        : { cwd: parent.cwd, additionalDirs: parent.additionalDirs, covers: parent.covers },
      target.settings,
      'starting',
      parentId,
    )
    // A helper never inherits Shared MCP access, so say what it starts without instead of leaving it to be discovered.
    try {
      const note = this.host.helperSetupNote()?.(child)
      if (note)
        this.host.record(child.id, {
          kind: 'settings',
          settings: target.settings,
          reason: note,
          handoff: false,
        })
    } catch {
      // The note is informational; a helper still starts without it.
    }
    const run: ChildRun = {
      parentId,
      name,
      ...(isolation ? { isolation } : {}),
      ...(input.type ? { type: input.type } : {}),
      prompt: input.prompt,
      report: !!input.background,
      settled: false,
      promptSeen: false,
      lastText: '',
      toolUses: 0,
      startedAt: Date.now(),
    }
    this.pendingStarts.delete(reservation)
    this.children.set(child.id, run)
    this.host.attempted.set(child.id, new Set([settingsKey(target.settings, catalogs)]))
    const settings = target.settings
    this.host.updateTask(parentId, child.id, {
      name,
      agentType: input.type,
      taskType: 'ramu_agent',
      childSessionId: child.id,
      status: 'running',
      background: !!input.background,
      prompt: input.prompt,
      startedAt: run.startedAt,
      address: child.id,
      canStop: true,
      canMessage: !isolation,
      ...(isolation ? { isolated: true } : {}),
      provider: settings.provider,
      model: settings.model,
      effort: settings.effort,
      ...(target.reason
        ? {
            steps: [
              { provider: target.from, reason: '', at: run.startedAt },
              { provider: settings.provider, model: settings.model, reason: target.reason, at: run.startedAt },
            ],
          }
        : {}),
    })
    const prefs = this.host.preferences()
    const context = prefs?.subagents.shareContext
      ? `<chat-context>\nThe conversation so far, for background only:\n${transcriptOf(this.host.events(parentId)).slice(-20_000)}\n</chat-context>\n\n`
      : ''
    this.host.launch(
      child.id,
      `${SUBAGENT_PREAMBLE}\n\n${context}Task: ${input.description.trim()}\n\n${input.prompt}`,
      null,
      true,
      [],
    )
    const done = (status: AgentTaskStatus, report: string): SubagentResult => ({
      agentId: child.id,
      name,
      status,
      report,
      provider: this.host.get(child.id).provider,
      model: this.host.get(child.id).settings.model,
    })
    if (input.background)
      return done('running', 'Started in the background. Its report arrives as a message when it finishes.')
    return new Promise<SubagentResult>((resolve) => {
      const timer = setTimeout(() => {
        if (run.waiter) {
          run.waiter = undefined
          run.report = true
          resolve(
            done('running', 'Still working after 45 minutes. Its report will arrive as a message when it finishes.'),
          )
        }
      }, FOREGROUND_WAIT_MS)
      run.waiter = (result) => {
        clearTimeout(timer)
        resolve(result)
      }
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          if (!run.settled) this.host.stop(child.id)
        },
        { once: true },
      )
    })
  }

  /** A note from a running sub-agent to its chat. It does not wait for a reply. */
  async messageParent(childId: string, text: string): Promise<void> {
    const run = this.children.get(childId)
    if (!run || run.settled) throw new Error('Only a running sub-agent that Ramu started can message its parent.')
    await this.reportToParent(run.parentId, subagentNotePrompt(run.name, 'says', childId, text))
  }

  /** A question from a running sub-agent to its chat; resolves with the answer, or a note to carry on if none comes. */
  async askParent(childId: string, question: string, signal?: AbortSignal): Promise<string> {
    const run = this.children.get(childId)
    if (!run || run.settled) throw new Error('Only a running sub-agent that Ramu started can ask its parent.')
    if (run.asking) throw new Error('A question is already waiting for an answer.')
    const answered = new Promise<string>((resolve) => {
      const timer = setTimeout(
        () => resolve('No answer arrived. Carry on with your best judgment and say in your report what you assumed.'),
        ASK_WAIT_MS,
      )
      const stop = () => resolve('The question was cancelled.')
      signal?.addEventListener('abort', stop, { once: true })
      run.asking = (answer) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
        resolve(answer)
      }
    })
    this.host.updateTask(run.parentId, childId, { waitingFor: 'input' })
    const text = subagentNotePrompt(run.name, 'asks', childId, question)
    if (run.waiter) {
      // The chat is blocked on this sub-agent's call, so it could not answer: hand the question back as that call's result and let the report follow as a message.
      const waiter = run.waiter
      run.waiter = undefined
      run.report = true
      const child = this.host.get(childId)
      waiter({
        agentId: childId,
        name: run.name,
        status: 'running',
        report: `${text}\n\nIt keeps waiting for your answer; its final report arrives as a message.`,
        provider: child.provider,
        model: child.settings.model,
      })
    } else void this.reportToParent(run.parentId, text)
    try {
      return await answered
    } finally {
      run.asking = undefined
      this.host.updateTask(run.parentId, childId, { waitingFor: null })
    }
  }

  /** The chat's answer to a sub-agent that asked a question. */
  answerSubagent(parentId: string, agentId: string, text: string): void {
    const run = this.children.get(agentId)
    if (!run || run.parentId !== parentId) throw new Error('Unknown sub-agent.')
    if (!run.asking)
      throw new Error(
        'That sub-agent is not waiting for an answer. Use SendMessage-style messaging from its card instead.',
      )
    run.asking(text.trim())
  }

  /** A sub-agent that worked in its own copy: apply what it did to the checkout, or keep the copy and say where it is. */
  private async finishIsolation(run: ChildRun, status: AgentTaskStatus): Promise<string> {
    const isolation = run.isolation!
    if (status === 'completed') {
      const outcome = await applyIsolation(isolation)
      const lines: string[] = []
      if (outcome.applied)
        lines.push(
          `Its changes (${outcome.applied} ${outcome.applied === 1 ? 'file' : 'files'}) are applied to the checkout.`,
        )
      for (const failure of outcome.failed)
        lines.push(
          `Its changes in ${failure.repo} could not be applied (${failure.reason}); they are kept in ${outcome.kept.find((dir) => dir.includes(failure.repo)) ?? isolation.root}.`,
        )
      return lines.length ? `\n\n${lines.join('\n')}` : ''
    }
    let changed = 0
    for (const repo of isolation.repos)
      changed += (await collectPatch(repo).catch(() => ({ files: [] as string[] }))).files.length
    if (!changed) {
      await removeIsolation(isolation)
      return ''
    }
    return `\n\nIt did not finish, so its ${changed} changed ${changed === 1 ? 'file was' : 'files were'} not applied. They are in ${isolation.root}.`
  }

  /** Delivers a background sub-agent's report as a message, once its chat can take one. */
  private async reportToParent(parentId: string, text: string, attempts = 6): Promise<void> {
    for (let attempt = 0; attempt < attempts && !this.host.shutdown(); attempt++) {
      let state: AgentSessionState
      try {
        state = this.host.get(parentId).state
      } catch {
        return
      }
      // A chat that was stopped or closed is not woken up by a helper finishing.
      if (state === 'stopped' || state === 'failed' || state === 'restored') return
      try {
        await this.host.submit(parentId, text, 'steer')
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    }
  }

  /** What a sub-agent says and does appears in its chat's panel, tagged with the agent; its approvals show in the chat itself. */
  mirrorChild(id: string, run: ChildRun, e: AgentEvent, replacesMessageId?: string): void {
    const parent = run.parentId
    switch (e.kind) {
      case 'user':
        if (run.promptSeen) this.host.record(parent, { kind: 'user', text: e.text, agentId: id })
        else run.promptSeen = true
        break
      case 'text':
        run.lastText = e.text
        this.host.record(
          parent,
          { kind: 'text', text: e.text, agentId: id, ...(e.messageId ? { messageId: `${id}:${e.messageId}` } : {}) },
          replacesMessageId ? `${id}:${replacesMessageId}` : undefined,
        )
        break
      case 'content':
        this.host.record(parent, { ...e, agentId: id, ...(e.messageId ? { messageId: `${id}:${e.messageId}` } : {}) })
        break
      case 'plan':
        this.host.record(parent, { ...e, agentId: id, messageId: `${id}:${e.messageId}` })
        break
      case 'turn-diff':
        this.host.record(parent, { ...e, turnId: `${id}:${e.turnId}`, agentId: id })
        break
      case 'thinking':
        this.host.record(
          parent,
          {
            kind: 'thinking',
            text: e.text,
            agentId: id,
            ...(e.messageId ? { messageId: `${id}:${e.messageId}` } : {}),
          },
          replacesMessageId ? `${id}:${replacesMessageId}` : undefined,
        )
        break
      case 'error':
        this.host.record(parent, { kind: 'error', message: e.message, agentId: id })
        break
      case 'tool-use':
        if (
          !this.host.events(parent).some((old) => old.kind === 'tool-use' && old.toolUseId === `${id}:${e.toolUseId}`)
        )
          run.toolUses++
        this.host.record(parent, { ...e, toolUseId: `${id}:${e.toolUseId}`, agentId: id })
        this.host.updateTask(parent, id, { lastTool: e.name, toolUses: run.toolUses })
        break
      case 'tool-result':
        this.host.record(parent, { ...e, toolUseId: `${id}:${e.toolUseId}`, agentId: id })
        break
      case 'permission-request':
        this.host.childRequests.set(forwardedRequestId(parent, id, e.requestId), {
          parentId: parent,
          childId: id,
          requestId: e.requestId,
        })
        this.host.record(parent, {
          ...e,
          title: `${run.name}: ${e.title}`,
          requestId: forwardedRequestId(parent, id, e.requestId),
          requestSource: { sessionId: id, agentId: id, name: run.name, requestId: e.requestId },
        })
        break
      case 'elicitation':
        this.host.childRequests.set(forwardedRequestId(parent, id, e.requestId), {
          parentId: parent,
          childId: id,
          requestId: e.requestId,
        })
        this.host.record(parent, {
          ...e,
          requestId: forwardedRequestId(parent, id, e.requestId),
          requestSource: { sessionId: id, agentId: id, name: run.name, requestId: e.requestId },
        })
        break
      case 'question':
        this.host.childRequests.set(forwardedRequestId(parent, id, e.requestId), {
          parentId: parent,
          childId: id,
          requestId: e.requestId,
        })
        this.host.record(parent, {
          ...e,
          requestId: forwardedRequestId(parent, id, e.requestId),
          requestSource: { sessionId: id, agentId: id, name: run.name, requestId: e.requestId },
        })
        break
      case 'question-state':
        this.host.record(parent, { ...e, requestId: forwardedRequestId(parent, id, e.requestId) })
        break
      case 'request-resolved':
        if (this.host.childRequests.delete(forwardedRequestId(parent, id, e.requestId)))
          this.host.record(parent, { ...e, requestId: forwardedRequestId(parent, id, e.requestId) })
        break
      case 'settings': {
        const task = this.host.task(parent, id)
        const steps = task?.steps ?? [
          {
            provider: e.previous?.provider ?? e.settings.provider,
            model: e.previous?.model,
            reason: '',
            at: run.startedAt,
          },
        ]
        this.host.updateTask(parent, id, {
          provider: e.settings.provider,
          model: e.settings.model,
          effort: e.settings.effort,
          steps: [
            ...steps,
            { provider: e.settings.provider, model: e.settings.model, reason: e.reason, at: Date.now() },
          ],
        })
        break
      }
    }
  }

  /** A native sub-agent died on a usage limit: pick its task up again on the next fallback, with what it had done. */
  continueNative(id: string, task: AgentTask): void {
    const prefs = this.host.preferences()
    if (
      !prefs?.subagents.continueNative ||
      this.children.has(task.agentId) ||
      task.taskType === 'local_bash' ||
      task.taskType === 'advisor'
    )
      return
    const parent = this.host.get(id)
    if (!parent.settings.autoFallback || parent.parentId || this.continued.has(task.agentId)) return
    this.continued.add(task.agentId)
    void (async () => {
      const catalogs = await this.host.catalog()
      await this.host.freshAccountUsage(parent.provider)
      const routing = this.host.routing(parent.settings)
      const policy = this.host.policyOf({ parentId: id }, catalogs, prefs)
      const settings = { ...parent.settings, model: task.model ?? parent.settings.model }
      const account = routing
        ? this.host.otherAccount(
            settings,
            routing,
            catalogs,
            policy.switchAt,
            new Set([accountKey(parent.provider, settings.accountId)]),
          )
        : null
      const step = account
        ? {
            id: '',
            provider: parent.provider,
            model: settings.model,
            effort: settings.effort,
            serviceTier: settings.serviceTier,
            accountId: account,
          }
        : nextStep(policy.order, {
            usage: routing?.usage ?? [],
            accounts: routing?.accounts,
            catalogs,
            switchAt: policy.switchAt,
            attempted: new Set([settingsKey(parent.settings, catalogs)]),
          })
      if (!step) return
      const lines = this.host
        .events(id)
        .filter((e) => e.agentId === task.agentId && e.kind !== 'agent')
        .map((e) =>
          e.kind === 'text'
            ? `AGENT: ${e.text}`
            : e.kind === 'tool-use'
              ? `TOOL ${e.name}: ${e.summary}`
              : e.kind === 'tool-result'
                ? `RESULT: ${e.summary}`
                : '',
        )
        .filter(Boolean)
        .join('\n')
      const prompt = `${task.prompt ?? task.name}\n\n<previous-attempt>\nA ${providerName(parent.provider)} sub-agent started this task and stopped when its usage limit was reached. What it had done so far:\n${lines.slice(-30_000) || '(nothing recorded)'}\n</previous-attempt>\nContinue from where it stopped. Do not repeat finished work.`
      this.host.updateTask(id, task.agentId, {
        status: 'stopped',
        summary: `Stopped: ${providerName(parent.provider)} limit reached. Continuing on ${providerName(step.provider)}.`,
      })
      await this.spawnSubagent(
        id,
        { description: task.name, prompt, type: task.agentType, background: true, name: task.name },
        undefined,
        { step, reason: `${providerName(parent.provider)} limit reached` },
      )
    })().catch((error) =>
      this.host.record(id, {
        kind: 'error',
        message: `Could not continue ${task.name} on the fallback: ${errorMessage(error)}`,
      }),
    )
  }

  /** Claude's own Agent tool, when Ramu should run the sub-agent instead: the call is refused and the model is pointed at `ramu_agent`. */
  subagentHooks(id: string): Options['hooks'] {
    return {
      PreToolUse: [
        {
          matcher: 'Agent|Task',
          hooks: [
            async (input) => {
              if (input.hook_event_name !== 'PreToolUse') return {}
              const type = str((input.tool_input as Record<string, unknown> | undefined)?.subagent_type)
              let decision: Awaited<ReturnType<FallbackRouter['subagentSettings']>>
              try {
                decision = await this.host.subagentSettings(id, type)
              } catch {
                return {}
              }
              if (!decision.redirect) return {}
              const where = `${providerName(decision.settings.provider)}${decision.settings.model ? ` ${decision.settings.model}` : ''}`
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  permissionDecisionReason: `Sub-agents run through Ramu here, on ${where}${decision.reason ? ` because ${decision.reason}` : ''}. Call the ramu_agent tool with the same description, prompt, type and background arguments instead of the Agent tool.`,
                },
              }
            },
          ],
        },
      ],
    }
  }

  /**
   * Codex's hook asks before one of its own sub-agents starts. A refusal tells the model to call `ramu_agent` instead,
   * the same as for Claude's Agent tool; no answer lets Codex's own sub-agent run.
   */
  async codexSpawnDecision(id: string, toolInput: unknown): Promise<{ deny: true; reason: string } | null> {
    const session = this.host.get(id)
    if (session.provider !== 'codex' || session.parentId) return null
    let parsed = toolInput
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        parsed = null
      }
    }
    const input = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    let decision: Awaited<ReturnType<FallbackRouter['subagentSettings']>>
    try {
      decision = await this.host.subagentSettings(id, str(input.agent_type) ?? str(input.role) ?? str(input.agent_role))
    } catch {
      return null
    }
    if (!decision.redirect) return null
    const where = `${providerName(decision.settings.provider)}${decision.settings.model ? ` ${decision.settings.model}` : ''}`
    return {
      deny: true,
      reason: `Sub-agents run through Ramu here, on ${where}${decision.reason ? ` because ${decision.reason}` : ''}. Call the ramu_agent tool with the same description, prompt and type instead of spawn_agent.`,
    }
  }

  /** Whether Codex's own sub-agent tools should be off, so every sub-agent goes through `ramu_agent`. */
  nativeSubagentsOff(s: AgentSessionInfo): boolean {
    const prefs = this.host.preferences()
    return !!prefs && !s.parentId && subagentTarget(prefs.subagents, s.provider, undefined) !== null
  }
}
