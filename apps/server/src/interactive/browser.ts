import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
let installing: Promise<void> | undefined

/** Use the version matched to Playwright, never a person's installed browser or profile. */
export function interactiveBrowserPath(): string | undefined {
  const path = process.env.RAMU_INTERACTIVE_BROWSER || chromium.executablePath()
  return existsSync(path) ? path : undefined
}

export async function ensureInteractiveBrowser(signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error('Preview cancelled')
  const installed = interactiveBrowserPath()
  if (installed) return installed
  if (process.env.RAMU_INTERACTIVE_BROWSER)
    throw new Error('RAMU_INTERACTIVE_BROWSER does not name an existing executable. Correct it and retry preview.')
  if (!installing) {
    const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js')
    installing = new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        [cli, 'install', 'chromium', '--no-shell'],
        { timeout: 120_000, maxBuffer: 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
        (error) => {
          if (error)
            reject(
              new Error(
                'Could not download the preview browser. Check this host’s network and retry, or set RAMU_INTERACTIVE_BROWSER to a Chromium executable.',
              ),
            )
          else resolve()
        },
      )
    }).finally(() => {
      installing = undefined
    })
  }
  // Each caller can stop waiting without cancelling a download another preview still needs.
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new Error('Preview cancelled'))
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    installing!.then(
      () => {
        cleanup()
        resolve()
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
  if (signal?.aborted) throw new Error('Preview cancelled')
  const path = interactiveBrowserPath()
  if (!path) throw new Error('The preview browser installation is incomplete. Retry preview on this host.')
  return path
}
