import { spawn } from 'node:child_process'
import { providerBinary, providerEnvironment } from './providerBinaries'
import { randomBytes } from 'node:crypto'

// The SDK launcher only recognizes the 1.x banner. Support both CLI banners and await process exit.
export async function startOpenCodeServer(cwd: string, signal?: AbortSignal, accountId?: string): Promise<{ url: string; headers: Record<string, string>; close(): Promise<void> }> {
  const password = randomBytes(32).toString('hex')
  const child = spawn(providerBinary('opencode'), ['serve', '--hostname=127.0.0.1', '--port=0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...providerEnvironment('opencode', undefined, accountId), OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: password } })
  let exited = false
  const done = new Promise<void>((resolve) => { const finish = () => { exited = true; resolve() }; child.once('exit', finish); child.once('error', finish) })
  const close = async () => { if (!exited) { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await done; clearTimeout(timer) } signal?.removeEventListener('abort', cancel) }
  const cancel = () => { void close() }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) await close()
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('OpenCode server startup timed out. Install and sign in to the OpenCode CLI first.')) }, 20_000)
      let buffer = ''
      const read = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString()).slice(-8192)
        const match = /(?:opencode )?server listening (?:on|at) (http:\/\/127\.0\.0\.1:\d+)/.exec(buffer)
        if (match) { clearTimeout(timer); resolve(match[1]!) }
      }
      child.stdout.on('data', read); child.stderr.on('data', read)
      child.once('error', () => { clearTimeout(timer); reject(new Error('Cannot start OpenCode. Install the OpenCode CLI first.')) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('OpenCode server stopped')) })
      if (signal?.aborted) { clearTimeout(timer); reject(new Error('OpenCode startup cancelled')) }
    })
    return { url, headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }, close }
  } catch (error) { await close(); throw error }
}
