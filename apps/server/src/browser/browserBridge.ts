import type { BrowserProfileCatalog } from '@ramu/shared/types/browser'
import type { BrowserBridgeRequest } from '@ramu/shared/browserBridge'
import { BrowserRuntime } from './browserRuntime'

/** Private messages from the local server, not renderer IPC. No caller can supply a different execution host. */
export async function executeBrowserBridge(
  runtime: BrowserRuntime,
  hostId: string,
  request: BrowserBridgeRequest,
  profiles?: () => BrowserProfileCatalog,
): Promise<unknown> {
  if (!request || typeof request.expiresAt !== 'number' || request.expiresAt <= Date.now())
    throw new Error('This browser request expired. Inspect the page before continuing.')
  const { threadId, runId, command } = request
  if (!threadId || !runId || threadId.length > 200 || runId.length > 200) throw new Error('Invalid browser owner')
  const owner = { hostId, threadId }
  const tabId = 'tabId' in command ? command.tabId : null
  if (tabId && !runtime.list(owner).some((tab) => tab.id === tabId))
    throw new Error('That tab belongs to another thread or is closed.')
  if (tabId) runtime.adoptReleased(tabId, runId, owner)
  switch (command.kind) {
    case 'download-prepare':
      return runtime.prepareDownload(command.tabId, runId, owner)
    case 'downloads':
      return runtime.listDownloads(owner, command.tabId)
    case 'download-read':
      return runtime.readDownload(command.tabId, runId, owner, command.downloadId, command.offset)
    case 'download-cancel':
      return runtime.cancelDownload(command.downloadId, owner)
    case 'upload-begin':
      return runtime.beginUpload(command.tabId, runId, owner, command.name, command.size)
    case 'upload-chunk':
      return runtime.uploadChunk(command.tabId, runId, owner, command.uploadId, command.offset, command.data)
    case 'upload-cancel':
      return runtime.cancelUpload(command.tabId, runId, owner, command.uploadId)
    case 'upload':
      return runtime.uploadForAgent(command.tabId, runId, owner, command.uploadId, command.snapshot, command.ref)
    case 'present':
      return runtime.list(owner).find((tab) => tab.id === command.tabId)
    case 'profiles':
      return profiles?.() ?? { profiles: [] }
    case 'list':
      return runtime.list(owner)
    case 'open':
      return runtime.open({ ...owner, runId }, command.url, command.profileId)
    case 'snapshot':
      return runtime.inspectForAgent(command.tabId, runId, owner)
    case 'click':
    case 'hover':
    case 'drag':
      return runtime.actForAgent(command.tabId, runId, owner, command)
    case 'select':
    case 'press':
    case 'scroll':
    case 'type':
      return runtime.actForAgent(command.tabId, runId, owner, command)
    case 'screenshot':
      return runtime.screenshotForAgent(command.tabId, runId, owner)
    case 'diagnostics':
      return runtime.diagnosticsForAgent(command.tabId, owner)
    case 'dialog':
      return runtime.dialogForAgent(command.tabId, owner)
    case 'handle-dialog':
      return runtime.handleDialogForAgent(
        command.tabId,
        runId,
        owner,
        command.dialogId,
        command.accept,
        command.promptText,
      )
    case 'wait':
      return runtime.waitForAgent(command.tabId, runId, owner, command.text, command.timeoutMs, command.urlIncludes)
    case 'navigate':
      return runtime.navigateForAgent(command.tabId, runId, owner, command.url)
    case 'back':
    case 'forward':
    case 'reload':
      return runtime.historyForAgent(command.tabId, runId, owner, command.kind)
    case 'close':
      return runtime.closeForAgent(command.tabId, runId, owner)
    case 'end':
      runtime.endRun({ ...owner, runId })
      return null
  }
}
