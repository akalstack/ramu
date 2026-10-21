import { randomUUID } from 'node:crypto'
import type { BrowserBridgeCommand, BrowserBridgeRequest } from '@ramu/shared/browserBridge'

/** One explicitly attached local desktop. Disconnects fail pending work; operations are never replayed. */
export class DesktopBrowserBroker {
  private attachment: { clientId: string; token: string; ready: boolean } | null = null
  private pending = new Map<
    string,
    {
      clientId: string
      threadId: string
      runId: string
      timer: NodeJS.Timeout
      resolve(value: unknown): void
      reject(error: Error): void
    }
  >()
  constructor(
    private readonly send: (clientId: string, request: BrowserBridgeRequest) => boolean,
    private readonly timeoutMs = 30000,
  ) {}

  /** The desktop currently attached, so a caller can tell whether it is still connected. */
  owner(): string | null {
    return this.attachment?.clientId ?? null
  }

  attach(clientId: string): { token: string } {
    if (this.attachment) {
      if (this.attachment.clientId !== clientId)
        throw new Error('Another desktop already owns the integrated browser connection.')
      this.detach(clientId)
    }
    const token = randomUUID()
    this.attachment = { clientId, token, ready: false }
    return { token }
  }

  ready(clientId: string, token: string) {
    if (this.attachment?.clientId !== clientId || this.attachment.token !== token)
      throw new Error('The browser connection is no longer active.')
    this.attachment.ready = true
  }

  status() {
    return { available: this.attachment?.ready === true, location: 'execution-host-desktop' as const }
  }

  detach(clientId: string) {
    if (this.attachment?.clientId !== clientId) return
    this.attachment = null
    for (const [id, operation] of this.pending) {
      clearTimeout(operation.timer)
      operation.reject(
        new Error(
          'The desktop browser disconnected. The operation may have run; inspect the page before trying another action.',
        ),
      )
      this.pending.delete(id)
    }
  }

  request(threadId: string, runId: string, command: BrowserBridgeCommand): Promise<unknown> {
    const attachment = this.attachment
    if (!attachment?.ready)
      return Promise.reject(new Error('Open Ramu on the execution host to use its integrated browser.'))
    if (this.pending.size >= 8)
      return Promise.reject(new Error('The browser is busy. Wait for the current operations to finish.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(
          new Error('The browser operation timed out and may have run. Inspect the page before trying another action.'),
        )
      }, this.timeoutMs)
      timer.unref?.()
      this.pending.set(requestId, { clientId: attachment.clientId, threadId, runId, timer, resolve, reject })
      try {
        if (
          !this.send(attachment.clientId, {
            requestId,
            clientId: attachment.clientId,
            threadId,
            runId,
            expiresAt: Date.now() + this.timeoutMs,
            command,
          })
        )
          this.detach(attachment.clientId)
      } catch {
        this.detach(attachment.clientId)
      }
    })
  }

  endRun(threadId: string, runId: string) {
    for (const [id, operation] of this.pending) {
      if (operation.threadId !== threadId || operation.runId !== runId) continue
      clearTimeout(operation.timer)
      this.pending.delete(id)
      operation.reject(new Error('The agent run stopped. Inspect the page before continuing.'))
    }
    const attachment = this.attachment
    if (attachment) {
      try {
        this.send(attachment.clientId, {
          requestId: randomUUID(),
          clientId: attachment.clientId,
          threadId,
          runId,
          expiresAt: Date.now() + this.timeoutMs,
          command: { kind: 'end' },
        })
      } catch {
        this.detach(attachment.clientId)
      }
    }
  }

  reply(clientId: string, token: string, requestId: string, value: unknown, error?: string): void {
    if (this.attachment?.clientId !== clientId || this.attachment.token !== token)
      throw new Error('The browser connection is no longer active.')
    const operation = this.pending.get(requestId)
    if (!operation || operation.clientId !== clientId) return // A late response never resurrects a timed-out operation.
    clearTimeout(operation.timer)
    this.pending.delete(requestId)
    if (error) operation.reject(new Error('The desktop browser refused the operation. ' + error.slice(0, 500)))
    else {
      try {
        if ((JSON.stringify(value)?.length ?? 0) > 200000)
          operation.reject(new Error('The browser response was too large.'))
        else operation.resolve(value)
      } catch {
        operation.reject(new Error('The browser returned an invalid response.'))
      }
    }
  }
}
