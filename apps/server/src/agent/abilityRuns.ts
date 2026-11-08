import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Ability, AbilityRoute, AbilitySource } from '@ramu/shared/providers/abilities'
import type { AbilityDeclaration } from '../providers/adapter'
import { codexAbility } from '../providers/codexAbility'
import { MAX_ATTACHMENT_BYTES } from '../attachments'
import { providerEnvironment } from '../providers/providerBinaries'
import { classifyLimit } from '../providers/limitClassifier'
import { InputQueue } from './inputQueue'
import type { QueryFn } from './types'

/** What a step sends the other provider: the caller's request, rendered as one prompt, and the images it passed. */
export interface AbilityRequest {
  ability: Ability
  prompt: string
  /** Host paths of images the provider sees with the prompt. */
  images: string[]
}

export interface AbilityOutput {
  text: string
  images: { bytes: Buffer; extension: string }[]
  sources: AbilitySource[]
  tokens?: { input: number; output: number }
  /** What the provider reported the step cost, in US dollars, where it reports one. */
  costUsd?: number
}

/** Runs one ability step on one provider login; Ramu's routing, approval and recording stay with the caller. */
export type AbilityRun = (
  route: AbilityRoute,
  declaration: AbilityDeclaration,
  request: AbilityRequest,
  signal: AbortSignal,
  timeoutMs: number,
) => Promise<AbilityOutput>

const markdownLinks = (text: string): AbilitySource[] =>
  [...text.matchAll(/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]{1,500})\)/g)].slice(0, 10).map((match) => ({
    title: match[1]!,
    url: match[2]!,
  }))

/**
 * A Claude query with no tools but the one the step needs (or none), no MCP servers, no settings files and no project:
 * it starts in an empty folder and every other tool is refused.
 */
async function claudeAbility(
  query: QueryFn,
  route: AbilityRoute,
  tool: string | null,
  request: AbilityRequest,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<AbilityOutput> {
  const cwd = mkdtempSync(join(tmpdir(), 'ramu-ability-'))
  const input = new InputQueue()
  const abort = new AbortController()
  const stop = () => abort.abort()
  signal.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, timeoutMs)
  try {
    const run = query({
      prompt: input,
      options: {
        cwd,
        tools: tool ? [tool] : [],
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: [],
        maxTurns: tool ? 8 : 1,
        abortController: abort,
        permissionMode: 'default',
        settings: { advisorModel: '' },
        env: providerEnvironment('claude-code', undefined, route.accountId),
        canUseTool: async (name, toolInput) =>
          name === tool
            ? { behavior: 'allow', updatedInput: toolInput }
            : { behavior: 'deny', message: 'Not available here' },
        ...(route.model ? { model: route.model } : {}),
      },
    })
    // Images the step reads (a vision call) go in as image blocks beside the prompt.
    input.push(
      request.prompt,
      request.images.map((path, index) => ({
        id: `image-${index + 1}`,
        name: basename(path),
        size: statSync(path).size,
        mimeType: /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png',
        path,
      })),
    )
    input.close()
    let text = ''
    let tokens: AbilityOutput['tokens']
    let costUsd: number | undefined
    for await (const message of run) {
      if (message.type === 'assistant')
        for (const block of message.message.content) if (block.type === 'text') text += block.text
      if (message.type === 'result') {
        if (message.is_error)
          throw new Error(
            classifyLimit(message, { provider: 'claude-code', channel: 'error' })?.confidence === 'high'
              ? 'usage_limit_reached'
              : 'Claude could not finish the request.',
          )
        const usage = message.usage as { input_tokens?: number; output_tokens?: number } | undefined
        if (typeof usage?.input_tokens === 'number' && typeof usage.output_tokens === 'number')
          tokens = { input: usage.input_tokens, output: usage.output_tokens }
        if (typeof message.total_cost_usd === 'number') costUsd = message.total_cost_usd
      }
    }
    if (abort.signal.aborted)
      throw new Error(signal.aborted ? 'The ability call was stopped' : 'The ability call timed out')
    return {
      text: text.trim(),
      images: [],
      sources: markdownLinks(text),
      ...(tokens ? { tokens } : {}),
      ...(costUsd === undefined ? {} : { costUsd }),
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    abort.abort()
    rmSync(cwd, { recursive: true, force: true })
  }
}

function imageFile(path: string): { bytes: Buffer; extension: string } {
  const size = statSync(path).size
  if (size <= 0 || size > MAX_ATTACHMENT_BYTES) throw new Error('The generated image is empty or larger than 10 MB.')
  const extension = /\.(png|jpe?g|webp|gif)$/i.exec(path)?.[1]?.toLowerCase() ?? 'png'
  return { bytes: readFileSync(path), extension }
}

/** The real step: Codex through its app-server, Claude through the Agent SDK. Other providers declare no abilities. */
export function abilityRunner(query: QueryFn): AbilityRun {
  return async (route, declaration, request, signal, timeoutMs) => {
    const tool = 'tool' in declaration.via ? declaration.via.tool : null
    if (route.provider === 'claude-code') return claudeAbility(query, route, tool, request, signal, timeoutMs)
    if (route.provider !== 'codex') throw new Error('This provider has no ability Ramu can call.')
    const cwd = mkdtempSync(join(tmpdir(), 'ramu-ability-'))
    try {
      const out = await codexAbility({
        accountId: route.accountId,
        model: route.model,
        tool: tool === 'image_gen' || tool === 'web_search' ? tool : null,
        prompt: request.prompt,
        images: request.images,
        cwd,
        signal,
        timeoutMs,
      })
      return {
        text: out.text.trim(),
        images: out.images
          .slice(0, 4)
          .map((image) =>
            'path' in image ? imageFile(image.path) : { bytes: Buffer.from(image.base64, 'base64'), extension: 'png' },
          ),
        sources: out.sources.length ? out.sources : markdownLinks(out.text),
        ...(out.tokens ? { tokens: out.tokens } : {}),
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}
