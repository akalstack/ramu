// Opt-in tests of the retained native Aside path on new ACP-owned audit chats.
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { CodexRpc, codexAside } from '../src/main/codex'
import { auditHost, textOf } from './acp-audit-host.mjs'

const runtime = resolve(process.env.RAMU_ACP_AUDIT_DIR || '/tmp/ramu-acp-audit/runtime')
describe.runIf(process.env.RAMU_ACP_LIVE === '1')('retained native Aside after ACP chat', () => {
  it('Claude native SDK fork reads context and leaves parent history unchanged', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-claude-aside-'))
    const sdk = await import(pathToFileURL(join(runtime, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')).href)
    const token = `ASIDE_${randomUUID().replaceAll('-', '')}`
    let host: Awaited<ReturnType<typeof auditHost>> | undefined
    let parentId: string | undefined
    let query: any
    try {
      host = await auditHost('claude', runtime, cwd, { options: { persistSession: true, tools: [] } })
      parentId = host.sessionId
      await host.prompt(`Remember this audit token: ${token}. Reply exactly ${token}. No tools.`)
      await host.close(); host = undefined
      const before = await sdk.getSessionMessages(parentId, { dir: cwd })
      let answer = ''
      let forkId: string | undefined
      query = sdk.query({ prompt: 'Reply only with the earlier audit token. No tools.', options: { cwd, resume: parentId, forkSession: true, persistSession: false, tools: [], settingSources: [], maxTurns: 1, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'Aside audit denies tools' }), pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE } })
      for await (const message of query) {
        if (message.session_id) forkId = message.session_id
        if (message.type === 'assistant') answer += message.message.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
        if (message.type === 'result') { expect(message.subtype).toBe('success'); break }
      }
      await query.close()
      expect(answer).toContain(token)
      expect(forkId).toBeTruthy()
      expect(forkId).not.toBe(parentId)
      expect(await sdk.getSessionMessages(parentId, { dir: cwd })).toEqual(before)
      console.log(JSON.stringify({ test: 'live-claude-retained-native-aside', passed: true, contextPreserved: true, forkIsIndependent: true, parentHistoryUnchanged: true, forkPersistenceDisabled: true }))
    } finally {
      if (query) await query.close()
      if (host) await host.close()
      if (parentId) await sdk.deleteSession(parentId, { dir: cwd })
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('Ramu codexAside uses an ephemeral native fork without changing saved parent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-codex-aside-'))
    const token = `ASIDE_${randomUUID().replaceAll('-', '')}`
    let host: Awaited<ReturnType<typeof auditHost>> | undefined
    let parentId: string | undefined
    let reader: CodexRpc | undefined
    try {
      host = await auditHost('codex', runtime, cwd)
      parentId = host.sessionId
      await host.mode('read-only')
      await host.prompt(`Remember this audit token: ${token}. Reply exactly ${token}. No tools.`)
      await host.close({ preserve: true }); host = undefined
      reader = new CodexRpc()
      await reader.initialize()
      const before = await reader.request('thread/read', { threadId: parentId, includeTurns: true })
      const savedBefore = await reader.request('thread/list', { cwd, limit: 100 })
      const answer = await codexAside({ threadId: parentId!, cwd, prompt: 'Reply only with the earlier audit token. Do not call any tools.', timeoutMs: 60000 })
      expect(answer).toContain(token)
      const after = await reader.request('thread/read', { threadId: parentId, includeTurns: true })
      expect(after.thread.turns).toEqual(before.thread.turns)
      const savedAfter = await reader.request('thread/list', { cwd, limit: 100 })
      expect(savedAfter.data.map((thread: any) => thread.id).sort()).toEqual(savedBefore.data.map((thread: any) => thread.id).sort())
      console.log(JSON.stringify({ test: 'live-codex-retained-native-aside', passed: true, testedActualRamuFunction: true, contextPreserved: true, parentHistoryUnchanged: true, noAdditionalSavedThread: true }))
    } finally {
      if (reader) await reader.close()
      if (!host && parentId) host = await auditHost('codex', runtime, cwd, { sessionId: parentId })
      if (host) await host.close()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  for (const provider of ['claude', 'codex'] as const) {
    it(`${provider} retained native Aside can read earlier context while the ACP parent executes a tool`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), `ramu-acp-active-${provider}-aside-`))
      const token = `ACTIVE_ASIDE_${randomUUID().replaceAll('-', '')}`
      const sdk = provider === 'claude' ? await import(pathToFileURL(join(runtime, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')).href) : undefined
      let host: Awaited<ReturnType<typeof auditHost>> | undefined
      let parentId: string | undefined
      let query: any
      let aside: Promise<string> | undefined
      let turnEnded = false
      let startedBeforeParentEnd = false
      const updates: any[] = []
      const nativeAside = async () => {
        startedBeforeParentEnd = !turnEnded
        if (provider === 'codex') return codexAside({ threadId: parentId!, cwd, prompt: 'ACP_SIDE_ONLY: Reply only with the earlier audit token. Do not call tools.', timeoutMs: 60000 })
        let answer = ''
        query = sdk!.query({ prompt: 'ACP_SIDE_ONLY: Reply only with the earlier audit token. Do not call tools.', options: { cwd, resume: parentId, forkSession: true, persistSession: false, tools: [], settingSources: [], maxTurns: 1, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'Aside audit denies tools' }), pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE } })
        for await (const message of query) {
          if (message.type === 'assistant') answer += message.message.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
          if (message.type === 'result') { expect(message.subtype).toBe('success'); break }
        }
        await query.close()
        return answer
      }
      try {
        host = await auditHost(provider, runtime, cwd, { options: { persistSession: true, tools: ['Bash'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }, onUpdate: async (event: any) => {
          updates.push(event)
          if (parentId && !aside && event.update.sessionUpdate === 'tool_call' && event.update.kind === 'execute') {
            // Avoid blocking the parent's event consumer while its independent fork runs.
            aside = new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 400)).then(nativeAside)
            aside.catch(() => {})
          }
        } })
        parentId = host.sessionId
        if (provider === 'codex') await host.mode('agent-full-access')
        await host.prompt(`Remember this audit token: ${token}. Reply exactly ${token}. Do not call tools.`)
        updates.length = 0
        const result = await host.prompt('Use the shell tool exactly once to execute sleep 10. No files, network, or other tools. Then reply exactly ACP_PARENT_TOOL_DONE.')
        turnEnded = true
        expect(result.stopReason).toBe('end_turn')
        expect(aside).toBeTruthy()
        expect(await aside).toContain(token)
        expect(startedBeforeParentEnd).toBe(true)
        expect(textOf(updates, parentId)).toContain('ACP_PARENT_TOOL_DONE')
        if (provider === 'claude') {
          const messages = await sdk!.getSessionMessages(parentId, { dir: cwd })
          expect(JSON.stringify(messages)).not.toContain('ACP_SIDE_ONLY')
        } else {
          const reader = new CodexRpc()
          try {
            await reader.initialize()
            const history = await reader.request('thread/read', { threadId: parentId, includeTurns: true })
            expect(JSON.stringify(history.thread.turns)).not.toContain('ACP_SIDE_ONLY')
            const saved = await reader.request('thread/list', { cwd, limit: 100 })
            expect(saved.data.map((thread: any) => thread.id)).toEqual([parentId])
          } finally { await reader.close() }
        }
        console.log(JSON.stringify({ test: `live-${provider}-aside-during-parent-tool`, passed: true, forkStartedDuringActiveTurn: true, earlierContextPreserved: true, parentTurnCompletedNormally: true, sidePromptAbsentFromParentHistory: true }))
      } finally {
        if (query) await query.close()
        if (host) await host.close()
        if (sdk && parentId) await sdk.deleteSession(parentId, { dir: cwd })
        await rm(cwd, { recursive: true, force: true })
      }
    })
  }
})
