import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProvider } from '@ramu/shared/types'
import type { ComputerCapture } from '@ramu/shared/computerBridge'

/**
 * Providers known to show an MCP image result to the model. The others get the same screenshot as a file the agent can
 * open, plus the accessibility text, because whether they show the inline image is only learned from a live run.
 */
const SHOWS_IMAGE_RESULTS: ReadonlySet<AgentProvider> = new Set(['claude-code'])

export const showsImageResults = (provider: AgentProvider): boolean => SHOWS_IMAGE_RESULTS.has(provider)

/**
 * The latest screenshot per thread as a private file, for providers that do not show MCP images. One file is kept per
 * thread and overwritten by the next observation. It is deleted when the run ends, Stop is pressed or access is revoked.
 */
export class EvidenceFiles {
  private dirs = new Map<string, Promise<string>>()

  async write(threadId: string, capture: Pick<ComputerCapture, 'data' | 'mimeType'>): Promise<string> {
    let dir = this.dirs.get(threadId)
    if (!dir) {
      dir = mkdtemp(join(tmpdir(), 'ramu-computer-'))
      this.dirs.set(threadId, dir)
    }
    const extension = capture.mimeType === 'image/png' ? 'png' : capture.mimeType === 'image/webp' ? 'webp' : 'jpg'
    const path = join(await dir, `observation.${extension}`)
    await writeFile(path, Buffer.from(capture.data, 'base64'), { mode: 0o600 })
    return path
  }

  async clear(threadId: string): Promise<void> {
    const dir = this.dirs.get(threadId)
    this.dirs.delete(threadId)
    if (dir) await rm(await dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** What the observe result tells a model that may not see the inline screenshot. */
export function imageFallback(
  provider: AgentProvider,
  capture: Pick<ComputerCapture, 'text'>,
  path: string | null,
): { screenshotPath?: string; note?: string } {
  if (showsImageResults(provider)) return {}
  const hasText = !!capture.text
  const parts = [
    'Your provider may not show the screenshot attached to this result.',
    path ? `The same screenshot is saved at screenshotPath; open that file if your tools can read images.` : '',
    hasText
      ? 'The accessibility field describes the app’s controls.'
      : 'This target has no accessibility text, so rely on the screenshot file and report if you cannot read it.',
  ]
  return { ...(path ? { screenshotPath: path } : {}), note: parts.filter(Boolean).join(' ') }
}
