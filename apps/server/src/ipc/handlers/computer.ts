import { z } from 'zod'
import { MAX_COMPUTER_TEXT, type ComputerAction } from '@ramu/shared/computerBridge'
import { MAIN_DISPLAY } from '../../computer/macos'
import { ComputerRouter } from '../../computer/router'
import { installOcu, ocuUpdateStatus, ocuPermissions, setupOcu } from '../../computer/ocu'
import { installIdb } from '../../testDevice/idb'
import { LockedUse } from '../../computer/lockedUse'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** How long a viewer's request waits for a changed screen. */
const FRAME_WAIT_MS = 1500

const coord = z.number().int().min(0).max(100000)
const action = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: coord,
    y: coord,
    button: z.enum(['left', 'right', 'middle']).optional(),
    clickCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  }),
  z.object({ kind: z.literal('type'), text: z.string().min(1).max(MAX_COMPUTER_TEXT) }),
  z.object({
    kind: z.literal('key'),
    key: z.string().min(1).max(40),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .max(4)
      .optional(),
  }),
  z.object({
    kind: z.literal('scroll'),
    x: coord,
    y: coord,
    dx: z.number().int().min(-10000).max(10000),
    dy: z.number().int().min(-10000).max(10000),
  }),
  z.object({ kind: z.literal('drag'), fromX: coord, fromY: coord, toX: coord, toY: coord }),
])

/** Computer use on this host. Setup and grants stay on the owning host; viewing devices need an explicit viewer grant. */
const lockedUse = new LockedUse()

export const registerComputerHandlers: RegisterHandlers = ({
  testDevices,
  computer,
  computerVideo: video,
  awake,
  host,
  workspace,
  agents,
}) => {
  let installingApps = false
  let installingIdb = false
  const ready = () => {
    if (!computer) throw new Error('Update this host for computer use.')
    return computer
  }
  const admin = () => {
    if (!host.canAdministerIntegrations?.())
      throw new Error('Computer use setup and grants must be reviewed on the owning host.')
    return ready()
  }
  // A paired owner already administers threads and terminals. Per-thread computer choices use that same identity.
  const owner = () => {
    if (!host.canAdministerIntegrations?.()) {
      const id = host.browserDevice?.()
      if (!id || !host.browserGrantEligible?.(id)) throw new Error('Pair an owner device to use this computer.')
    }
    return ready()
  }
  const device = () => host.browserDevice?.() ?? 'local'
  const thread = (threadId: string) => {
    workspace.getTask(threadId)
    return threadId
  }
  const enabled = () => workspace.getAppState<boolean>('computer:enabled', false) === true
  const viewer = (threadId: string) => {
    const service = ready()
    const who = device()
    // The host itself, or a paired owner device: the call already passed this device's Computer use permission.
    if (who !== 'local' && !host.browserGrantEligible?.(who))
      throw new Error('This device was not granted access to this computer.')
    thread(threadId)
    const session = service.session(threadId)
    if (!session) throw new Error('No computer is granted to this thread.')
    return session
  }
  const summary = (threadId: string) => {
    const session = ready().session(threadId)
    if (!session) return null
    const { controller, generation, paused } = session.state
    return {
      target: session.target,
      controller,
      generation,
      paused,
      runtime: session.runtime,
      os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      interruption: session.interruption,
      handoffRequest: session.handoffRequest,
      detectsLocalInput: session.detectsLocalInput,
      controlledHere: controller.kind === 'human' && controller.deviceId === device(),
    }
  }
  return {
    'testDevices.status': {
      args: z.tuple([]),
      run: () => {
        if (!testDevices) throw new Error('Test devices are unavailable on this host.')
        return testDevices.status()
      },
    },
    'testDevices.setEnabled': {
      args: z.tuple([z.boolean()]),
      run: async (enabled: boolean) => {
        workspace.setAppState('test-devices:enabled', enabled)
        if (!enabled) await testDevices?.stopAll()
      },
    },
    'testDevices.stop': {
      args: z.tuple([z.string().min(1).max(200)]),
      run: (deviceId: string) => testDevices?.stop(deviceId),
    },
    // Runs Homebrew and pip on the host, so only its owner can start it.
    'testDevices.installHelper': {
      args: z.tuple([]),
      run: async () => {
        if (!host.canAdministerIntegrations?.()) throw new Error('Install idb on the owning host.')
        if (installingIdb) throw new Error('idb installation is already running.')
        installingIdb = true
        try {
          await installIdb()
        } finally {
          installingIdb = false
        }
      },
    },
    'computer.status': {
      args: z.tuple([]),
      run: async () => ({
        appPermissions: await ocuPermissions(),
        enabled: enabled(),
        runtime: computer ? computer.status() : ({ available: false, reason: 'unsupported' } as const),
        apps: computer?.backend instanceof ComputerRouter ? computer.backend.appStatus() : null,
        // The host's own Keep awake setting decides whether it can sleep while an agent works on it.
        keepAwake: awake.status().active,
        globalPointer: workspace.getAppState<boolean>('computer:globalPointer', false) === true,
        appVersion: ocuUpdateStatus().installedVersion ?? undefined,
        appUpdate: ocuUpdateStatus(),
      }),
    },
    // Lets drags in an app move windows and select text by using the real pointer. Off unless the owner turns it on.
    'computer.setGlobalPointer': {
      args: z.tuple([z.boolean()]),
      run: (value: boolean) => {
        admin()
        workspace.setAppState('computer:globalPointer', value)
      },
    },
    'computer.setEnabled': {
      args: z.tuple([z.boolean()]),
      run: (value: boolean) => {
        const service = owner()
        workspace.setAppState('computer:enabled', value)
        if (value) service.backend.warm?.()
        if (!value) for (const task of workspace.listTasks()) service.revoke(task.id)
      },
    },
    // Working through a locked screen installs macOS sign-in components, so it is reviewed and started on the owning host.
    // Whether it is on is only read, so a paired owner device sees it too.
    'computer.lockedUse': { args: z.tuple([]), run: () => (owner(), lockedUse.status()) },
    'computer.lockedUseEnable': { args: z.tuple([]), run: () => (admin(), lockedUse.enable()) },
    'computer.lockedUseDisable': { args: z.tuple([]), run: () => (admin(), lockedUse.disable()) },
    'computer.installApps': {
      args: z.tuple([]),
      run: async () => {
        admin()
        if (installingApps) throw new Error('Open Computer Use installation is already running.')
        if (workspace.listTasks().some((task) => computer?.session(task.id)))
          throw new Error('Stop computer use in every thread before updating.')
        if (process.env.RAMU_OCU_PATH)
          throw new Error('This host uses a custom Open Computer Use path. Update it on the owning host.')
        installingApps = true
        try {
          if (computer?.backend instanceof ComputerRouter) await computer.backend.closeApps()
          const version = await installOcu()
          await setupOcu()
          return { version }
        } finally {
          installingApps = false
        }
      },
    },
    'computer.openSetup': {
      args: z.tuple([]),
      run: async () => {
        admin()
        await setupOcu()
      },
    },
    'computer.resetDefaults': {
      args: z.tuple([]),
      run: async () => {
        const service = admin()
        workspace.setAppState('computer:enabled', false)
        workspace.setAppState('computer:globalPointer', false)
        for (const task of workspace.listTasks()) service.revoke(task.id)
        const locked = await lockedUse.status()
        if (locked.enabled) await lockedUse.disable()
      },
    },
    'computer.apps': {
      args: z.tuple([]),
      run: async () => {
        const service = owner()
        return service.backend instanceof ComputerRouter ? service.backend.listApps() : []
      },
    },
    'computer.grant': {
      args: z.tuple([
        id,
        z.object({
          observe: z.boolean(),
          input: z.boolean(),
          app: z.string().min(1).max(200).optional(),
        }),
      ]),
      run: async (threadId: string, scope: { observe: boolean; input: boolean; app?: string }) => {
        const service = owner()
        if (installingApps) throw new Error('Wait for the Open Computer Use update to finish.')
        if (!enabled()) throw new Error('Turn on computer use in Settings first.')
        const backend = service.backend
        let target = MAIN_DISPLAY
        if (scope.app !== undefined) {
          if (!(backend instanceof ComputerRouter)) throw new Error('This host cannot limit access to one app.')
          const status = backend.appStatus()
          if (!status.available) throw new Error(status.detail ?? 'App control is not available on this computer.')
          // Only an app that is running or recently used can be granted, never an arbitrary string.
          const known = await backend.listApps()
          if (!known.includes(scope.app)) throw new Error(`${scope.app} is not a running or recently used app.`)
          target = { id: `app:${scope.app}`, kind: 'app', name: scope.app }
        } else {
          const status = backend.status()
          if (!status.available) throw new Error(status.detail ?? 'Computer use is not available on this computer.')
        }
        owner()
        if (!enabled() || installingApps) throw new Error('Computer access changed. Choose the target again.')
        service.grant(thread(threadId), { target, observe: scope.observe, input: scope.input && scope.observe })
        return summary(threadId)
      },
    },
    'computer.revoke': { args: z.tuple([id]), run: (threadId: string) => owner().revoke(thread(threadId)) },
    'computer.sessions': {
      args: z.tuple([]),
      run: () =>
        owner()
          .sessionThreads()
          .flatMap((threadId) => {
            try {
              thread(threadId)
              return [{ threadId, ...summary(threadId)! }]
            } catch {
              return []
            }
          }),
    },
    'computer.session': { args: z.tuple([id]), run: (threadId: string) => summary(thread(threadId)) },
    'computer.takeControl': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId).takeControl(device())
        return summary(threadId)
      },
    },
    // Older viewers ask the device in control instead of taking it; the device in control can still answer.
    'computer.requestHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId).requestHandoff(device())
        return summary(threadId)
      },
    },
    'computer.approveHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        const session = viewer(threadId)
        const requester = session.handoffRequest
        if (requester && requester !== 'local' && !host.browserGrantEligible?.(requester))
          throw new Error('That device is no longer allowed to control this computer.')
        session.approveHandoff(device())
        return summary(threadId)
      },
    },
    'computer.declineHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId).declineHandoff(device())
        return summary(threadId)
      },
    },
    'computer.giveToAgent': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        // The run is the thread's live agent session, never a value the caller supplies.
        const runs = agents.list(threadId)
        const run = runs.findLast((session) => ['starting', 'running'].includes(session.state)) ?? runs.at(-1)
        if (!run) throw new Error('This thread has no agent to give control to.')
        viewer(threadId).giveToAgent(device(), run.id)
        return summary(threadId)
      },
    },
    'computer.stop': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        const session = viewer(threadId)
        for (const run of agents.list(threadId)) session.stop(run.id)
        session.controllerDisconnected(device())
        return summary(threadId)
      },
    },
    'computer.frame': {
      // `since` is the hash of the frame the viewer already shows. The host captures in the background while anyone
      // watches, and this request returns the moment the screen changes (or after a short wait with no image), so an
      // idle screen costs a few bytes. Every request is authorized on its own.
      args: z.union([z.tuple([id]), z.tuple([id, z.string().max(80)])]),
      run: async (threadId: string, since?: string) => {
        const { capture, hash, ...meta } = await viewer(threadId).view(since, since ? FRAME_WAIT_MS : 0)
        if (since === hash) return { ...meta, hash, unchanged: true as const }
        return { ...meta, hash, mimeType: capture.mimeType, data: capture.data }
      },
    },
    // Smooth video of the main display: the viewer's offer comes in, this host's answer goes back, and the stream is the
    // shared hardware H.264 encode. Other targets, and viewers that cannot decode it, use the image frames above.
    'computer.rtcOffer': {
      args: z.tuple([id, z.string().min(20).max(60_000)]),
      run: async (threadId: string, offer: string) => {
        if (!video) throw new Error('Update this host for video.')
        const session = viewer(threadId)
        if (session.runtime.id !== 'local') throw new Error('Video is available for this computer. Use image frames.')
        if (session.target.kind === 'display') return video.answer(threadId, device(), offer)
        // An app's window streams while the Mac is unlocked. Behind the lock only Open Computer Use's snapshots see it.
        if (await ready().backend.locked?.()) throw new Error('This Mac is locked, so the app is shown as snapshots.')
        // Sized to the app's snapshots, so a point in the video is the same point for Open Computer Use's input.
        const { width, height } = await session.view()
        return video.answer(threadId, device(), offer, { kind: 'window', app: session.target.name, width, height })
      },
    },
    'computer.rtcKeyFrame': {
      args: z.tuple([id, z.string().uuid()]),
      run: (threadId: string, peerId: string) => {
        viewer(threadId)
        video?.keyFrame(peerId, device())
      },
    },
    'computer.rtcClose': {
      args: z.tuple([id, z.string().uuid()]),
      run: (_threadId: string, peerId: string) => video?.closeFor(peerId, device()),
    },
    'computer.input': {
      args: z.tuple([id, z.number().int().min(0), z.number(), action]),
      // The frame time stays in the call for clients that send it; input is no longer refused for an old picture.
      run: (threadId: string, generation: number, _capturedAt: number, input: ComputerAction) =>
        viewer(threadId).humanInput(device(), generation, input),
    },
    'computer.focus': {
      args: z.tuple([id]),
      run: (threadId: string) => viewer(threadId).focusedField(device()),
    },
    'computer.disconnect': {
      args: z.tuple([id]),
      run: (threadId: string) => viewer(threadId).controllerDisconnected(device()),
    },
  }
}
