import { z } from 'zod'
import type { RegisterHandlers } from '../types'
import { id } from '../schemas'
import { saveBrowserDownload } from '../../browser/download'
import { readBrowserUpload } from '../../browser/upload'
import { DesktopBrowserViewer, type BrowserViewerBackend } from '../../browser/desktopViewer'

const NO_TRANSFERS =
  'The desktop browser cannot send or receive files from a phone yet. Use the browser on the computer for file transfers.'

const tab = z.string().uuid()
const input = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    button: z.enum(['left', 'right', 'middle']),
    clickCount: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ kind: z.literal('scroll'), x: z.number().min(-2000).max(2000), y: z.number().min(-2000).max(2000) }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(2000) }),
  z.object({
    kind: z.literal('key'),
    key: z.enum([
      'Enter',
      'Escape',
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Backspace',
      'Delete',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]),
  }),
])
export const registerHostBrowserHandlers: RegisterHandlers = ({
  hostBrowser,
  browser,
  host,
  workspace,
  agents,
  loadPreferences,
  savePreferences,
}) => {
  const ready = () => {
    if (!hostBrowser) throw new Error('Update this host for remote browser viewing.')
    return hostBrowser
  }
  // Paired devices view whichever browser the agent uses: the host-managed Chromium, or the attached desktop's.
  const desktop = browser ? new DesktopBrowserViewer(browser) : undefined
  const viewer = (): BrowserViewerBackend => {
    if (hostBrowser?.selected()) return hostBrowser
    if (desktop && browser?.isReady()) return desktop
    return ready()
  }
  // File transfers need the host-managed browser's storage; the desktop's stay on the computer.
  const transfers = () => {
    if (!hostBrowser?.selected()) throw new Error(NO_TRANSFERS)
    return ready()
  }
  const admin = () => {
    if (!host.canAdministerIntegrations?.())
      throw new Error('Browser setup and device grants must be reviewed on the owning host.')
    return ready()
  }
  const device = () => {
    const identity = host.browserDevice?.()
    if (!identity) throw new Error('Pair this device before requesting browser viewing.')
    if (identity !== 'local' && !host.browserGrantEligible?.(identity))
      throw new Error('Pair an owner device to use this host browser.')
    return identity
  }
  const thread = (threadId: string) => {
    workspace.getTask(threadId)
    return threadId
  }
  return {
    'hostBrowser.status': {
      args: z.tuple([]),
      run: () => {
        const status = hostBrowser?.status() ?? {
          available: false,
          reason: 'Update this host for remote browser viewing.',
        }
        // viewable: a paired device can see and control the browser the agent uses, whichever one that is.
        const viewable = !!hostBrowser?.selected() || (!!browser?.isReady() && !hostBrowser?.selected())
        return { ...status, viewable }
      },
    },
    'hostBrowser.profiles': { args: z.tuple([]), run: () => (device(), ready().catalog()) },
    'hostBrowser.profileCreate': {
      args: z.tuple([z.string().min(1).max(80)]),
      run: (name) => admin().createProfile(name),
    },
    'hostBrowser.profileRename': {
      args: z.tuple([id, z.string().min(1).max(80)]),
      run: (id, name) => admin().renameProfile(id, name),
    },
    'hostBrowser.profileReview': {
      args: z.tuple([id, z.boolean()]),
      run: (id, remove) => admin().reviewProfile(id, remove),
    },
    'hostBrowser.profileConfirm': {
      args: z.tuple([z.string().uuid()]),
      run: (token) =>
        admin().confirmProfile(token, async (id) => {
          const preferences = loadPreferences()
          if (preferences.agentBrowser?.defaultProfileId === id)
            savePreferences({
              ...preferences,
              agentBrowser: { ...preferences.agentBrowser, defaultProfileId: 'default' },
            })
        }),
    },
    'hostBrowser.setup': { args: z.tuple([]), run: () => admin().setup() },
    'hostBrowser.disable': { args: z.tuple([]), run: () => admin().disable() },
    'hostBrowser.grants': { args: z.tuple([]), run: () => admin().grantsList() },
    'hostBrowser.grant': {
      args: z.tuple([id, id]),
      run: (deviceId: string, taskId: string) => {
        if (!host.browserGrantEligible?.(deviceId))
          throw new Error('Choose a paired owner device. Viewer pairing grants no browser access.')
        return admin().grant(deviceId, thread(taskId))
      },
    },
    'hostBrowser.revoke': {
      args: z.tuple([id, id]),
      run: (deviceId: string, taskId: string) => admin().revoke(deviceId, thread(taskId)),
    },
    'hostBrowser.list': {
      args: z.tuple([id]),
      run: async (taskId: string) => {
        const who = device()
        const id = thread(taskId)
        if (hostBrowser?.selected()) await hostBrowser.prepare()
        return viewer().list(who, id)
      },
    },
    'hostBrowser.open': {
      args: z.tuple([
        id,
        z.string().url().max(4000),
        z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
          .optional(),
      ]),
      run: async (taskId: string, url: string, profileId?: string) => {
        const who = device()
        const id = thread(taskId)
        if (hostBrowser?.selected()) await hostBrowser.prepare()
        return viewer().open(who, id, url, profileId)
      },
    },
    'hostBrowser.close': {
      args: z.tuple([id, tab]),
      run: (taskId: string, tabId: string) => viewer().closeTab(device(), thread(taskId), tabId),
    },
    'hostBrowser.history': {
      args: z.tuple([id, tab, z.enum(['back', 'forward', 'reload'])]),
      run: (taskId, tabId, direction) => viewer().history(device(), thread(taskId), tabId, direction),
    },
    'hostBrowser.dialog': {
      args: z.tuple([id, tab]),
      run: (taskId, tabId) => viewer().dialog(device(), thread(taskId), tabId),
    },
    'hostBrowser.answerDialog': {
      args: z.tuple([id, tab, tab, z.boolean(), z.string().max(20000).optional()]),
      run: (taskId, tabId, dialogId, accept, text) =>
        viewer().answerDialog(device(), thread(taskId), tabId, dialogId, accept, text),
    },
    'hostBrowser.frame': {
      args: z.tuple([id, tab]),
      run: (taskId: string, tabId: string) => viewer().frame(device(), thread(taskId), tabId),
    },
    'hostBrowser.read': {
      args: z.tuple([id, tab]),
      run: (taskId: string, tabId: string) => viewer().read(device(), thread(taskId), tabId),
    },
    'hostBrowser.upload': {
      args: z.tuple([
        id,
        tab,
        z.number().int().nonnegative(),
        z.number().int().positive(),
        z.number().int().min(1).max(200),
        z.string().min(1).max(4000),
        z.number().int().min(0).max(100).default(0),
      ]),
      run: async (taskId, tabId, generation, snapshot, ref, path, rootIndex) => {
        const identity = device()
        thread(taskId)
        transfers().list(identity, taskId)
        const scope = workspace.agentScope(taskId)
        const file = await readBrowserUpload(scope, path, rootIndex)
        if (JSON.stringify(workspace.agentScope(taskId)) !== JSON.stringify(scope))
          throw new Error('The upload workspace changed. Review it again.')
        return transfers().upload(identity, taskId, tabId, generation, snapshot, ref, {
          name: file.name,
          data: file.data.toString('base64'),
        })
      },
    },
    'hostBrowser.downloads': {
      args: z.tuple([id]),
      run: (taskId: string) => (hostBrowser?.selected() ? ready().downloads(device(), thread(taskId)) : []),
    },
    'hostBrowser.allowDownload': {
      args: z.tuple([id, tab]),
      run: (taskId, tabId) => transfers().allowDownload(device(), thread(taskId), tabId),
    },
    'hostBrowser.cancelDownload': {
      args: z.tuple([id, tab]),
      run: (taskId, downloadId) => transfers().cancelDownload(device(), thread(taskId), downloadId),
    },
    'hostBrowser.saveDownload': {
      args: z.tuple([id, tab, z.string().min(1).max(4000), z.number().int().min(0).max(100).default(0)]),
      run: (taskId, downloadId, path, rootIndex) => {
        const identity = device()
        thread(taskId)
        transfers()
        const scope = workspace.agentScope(taskId)
        const active = () => {
          ready().downloads(identity, taskId)
          const latest = workspace.agentScope(taskId)
          if (JSON.stringify(latest) !== JSON.stringify(scope))
            throw new Error('The workspace changed during the download.')
        }
        return saveBrowserDownload(
          scope,
          path,
          rootIndex,
          (offset) => Promise.resolve(ready().readDownload(identity, taskId, downloadId, offset)),
          active,
        )
      },
    },
    'hostBrowser.take': {
      args: z.tuple([id, tab]),
      run: (taskId: string, tabId: string) => viewer().take(device(), thread(taskId), tabId),
    },
    'hostBrowser.release': {
      args: z.tuple([id, tab]),
      run: (taskId: string, tabId: string) => {
        const active = agents
          .list(thread(taskId))
          .findLast((session) => !session.parentId && ['running', 'starting', 'needs-input'].includes(session.state))
        return viewer().release(device(), taskId, tabId, active?.id)
      },
    },
    'hostBrowser.input': {
      args: z.tuple([id, tab, z.number().int().nonnegative(), input]),
      run: (taskId, tabId, generation, action) => viewer().input(device(), thread(taskId), tabId, generation, action),
    },
    'hostBrowser.navigate': {
      args: z.tuple([id, tab, z.string().url().max(4000)]),
      run: (taskId: string, tabId: string, url: string) => viewer().navigate(device(), thread(taskId), tabId, url),
    },
    'hostBrowser.disconnect': { args: z.tuple([]), run: () => viewer().disconnect(device()) },
  }
}
