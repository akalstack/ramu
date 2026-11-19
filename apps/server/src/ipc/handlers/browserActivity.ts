import { z } from 'zod'
import { lookup } from 'node:dns/promises'
import { canOpenBrowserLinkOnDevice } from '@ramu/shared/browserLinks'
import { isPublicMcpAddress } from '../../mcp/http'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const tabs = z
  .array(
    z.object({
      id: z.string().uuid(),
      hostId: z.string().max(200),
      threadId: z.string().max(200),
      runId: z.string().max(200).nullable(),
      profileId: z.string().max(100),
      url: z.string().max(4000),
      title: z.string().max(1000),
      controller: z.enum(['human', 'agent', 'none']),
      generation: z.number().int().nonnegative(),
      inputReady: z.boolean(),
      paused: z.boolean(),
      crashed: z.boolean(),
      released: z.boolean().optional(),
    }),
  )
  .max(24)

async function externalURL(url: string): Promise<string | null> {
  if (!canOpenBrowserLinkOnDevice(url)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      lookup(new URL(url).hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS check timed out')), 1500)
        timer.unref?.()
      }),
    ])
    return addresses.length && addresses.every((entry) => isPublicMcpAddress(entry.address)) ? url : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Metadata only. Pairing never exposes a screenshot, credentials or control through this method. */
export const registerBrowserActivityHandlers: RegisterHandlers = ({ agents, workspace, browser }) => ({
  'browser.activity': {
    args: z.tuple([id]),
    run: async (taskId: string) => {
      workspace.getTask(taskId)
      if (!browser?.status().available) return { available: false, tabs: [] }
      const session = agents
        .list(taskId)
        .filter((session) => !session.parentId)
        .at(-1)
      if (!session) return { available: true, tabs: [] }
      const result = tabs.parse(await browser.request(taskId, session.id, { kind: 'list' }))
      const owned = result.filter((tab) => tab.threadId === taskId) as BrowserTabInfo[]
      const externalURLs = (await Promise.all([...new Set(owned.map((tab) => tab.url))].map(externalURL))).filter(
        (url): url is string => !!url,
      )
      return { available: true, tabs: owned, externalURLs }
    },
  },
})
