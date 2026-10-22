import { z } from 'zod'
import {
  MAX_COMPUTER_TEXT,
  type BrokerCommand,
  type BrokerOutcome,
  type ComputerAction,
  type ComputerBackend,
  type ComputerRuntimeStatus,
} from '@ramu/shared/computerBridge'
import { MAIN_DISPLAY } from '../../computer/macos'
import { ComputerRouter } from '../../computer/router'
import { installOcu, ocuUpdateStatus } from '../../computer/ocu'
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
  computer,
  computerBroker: broker,
  computerVideo: video,
  awake,
  host,
  workspace,
  agents,
}) => {
  let installingApps = false
  const ready = () => {
    if (!computer) throw new Error('Update this host for computer use.')
    return computer
  }
  const admin = () => {
    if (!host.canAdministerIntegrations?.())
      throw new Error('Computer use setup and grants must be reviewed on the owning host.')
    return ready()
  }
  const allowedRuntimes = () => workspace.getAppState<string[]>('computer:runtimes', [])
  /** A broker is a paired owner device the host's owner explicitly allowed; the local device never brokers. */
  const brokerDevice = () => {
    const deviceId = host.browserDevice?.()
    if (!broker) throw new Error('Update this host to use another computer.')
    if (!deviceId || deviceId === 'local') throw new Error('Only a paired computer can share its screen.')
    if (!allowedRuntimes().includes(deviceId))
      throw new Error('This computer is not allowed to share its screen with this host.')
    return deviceId
  }
  const device = () => host.browserDevice?.() ?? 'local'
  const thread = (threadId: string) => {
    workspace.getTask(threadId)
    return threadId
  }
  const enabled = () => workspace.getAppState<boolean>('computer:enabled', false) === true
  const viewer = (threadId: string, input: boolean) => {
    const service = ready()
    const access = service.viewerAccess(thread(threadId), device())
    if (!(input ? access.input : access.observe))
      throw new Error('This device was not granted access to this computer.')
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
      interruption: session.interruption,
      handoffRequest: session.handoffRequest,
      detectsLocalInput: session.detectsLocalInput,
    }
  }
  return {
    'computer.status': {
      args: z.tuple([]),
      run: () => ({
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
        const service = admin()
        workspace.setAppState('computer:enabled', value)
        if (value) service.backend.warm?.()
        if (!value) for (const task of workspace.listTasks()) service.revoke(task.id)
      },
    },
    // Working through a locked screen installs macOS sign-in components, so it is reviewed and started on the owning host.
    'computer.lockedUse': { args: z.tuple([]), run: () => (admin(), lockedUse.status()) },
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
          return { version: await installOcu() }
        } finally {
          installingApps = false
        }
      },
    },
    'computer.resetDefaults': {
      args: z.tuple([]),
      run: async () => {
        const service = admin()
        workspace.setAppState('computer:enabled', false)
        workspace.setAppState('computer:globalPointer', false)
        workspace.setAppState('computer:runtimes', [])
        for (const task of workspace.listTasks()) service.revoke(task.id)
        const locked = await lockedUse.status()
        if (locked.enabled) await lockedUse.disable()
      },
    },
    'computer.apps': {
      args: z.union([z.tuple([]), z.tuple([id])]),
      run: async (runtime?: string) => {
        const service = admin()
        if (runtime && runtime !== 'local') {
          if (!allowedRuntimes().includes(runtime) || !broker)
            throw new Error('That computer is not allowed to share its screen.')
          return broker.backendFor(runtime).apps()
        }
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
          runtime: id.optional(),
        }),
      ]),
      run: async (threadId: string, scope: { observe: boolean; input: boolean; app?: string; runtime?: string }) => {
        const service = admin()
        if (installingApps) throw new Error('Wait for the Open Computer Use update to finish.')
        if (!enabled()) throw new Error('Turn on computer use in Settings first.')
        const remoteId = scope.runtime && scope.runtime !== 'local' ? scope.runtime : null
        let backend: ComputerBackend = service.backend
        let runtime: { id: string; name: string; backend: ComputerBackend } | undefined
        let appsFrom: { listApps(): Promise<string[]>; appStatus(): ComputerRuntimeStatus } | null =
          service.backend instanceof ComputerRouter ? service.backend : null
        if (remoteId) {
          if (!allowedRuntimes().includes(remoteId))
            throw new Error('That computer is not allowed to share its screen.')
          if (!broker) throw new Error('Update this host to use another computer.')
          const remote = broker.backendFor(remoteId)
          const status = remote.status()
          if (!status.available) throw new Error(status.detail ?? 'That computer is offline.')
          backend = remote
          runtime = { id: remoteId, name: status.computer.name, backend: remote }
          appsFrom = { listApps: () => remote.apps(), appStatus: () => status }
        }
        let target = MAIN_DISPLAY
        if (scope.app !== undefined) {
          if (!appsFrom) throw new Error('This host cannot limit access to one app.')
          const status = appsFrom.appStatus()
          if (!status.available) throw new Error(status.detail ?? 'App control is not available on that computer.')
          // Only an app that is running or recently used can be granted, never an arbitrary string.
          const known = await appsFrom.listApps()
          if (!known.includes(scope.app)) throw new Error(`${scope.app} is not a running or recently used app.`)
          target = { id: `app:${scope.app}`, kind: 'app', name: scope.app }
        } else {
          const status = backend.status()
          if (!status.available) throw new Error(status.detail ?? 'Computer use is not available on that computer.')
        }
        service.grant(
          thread(threadId),
          { target, observe: scope.observe, input: scope.input && scope.observe },
          runtime,
        )
        return summary(threadId)
      },
    },
    'computer.runtimes': {
      args: z.tuple([]),
      run: () => {
        admin()
        const local = ready().status()
        const allowed = allowedRuntimes()
        return [
          { id: 'local', name: local.available ? local.computer.name : 'This computer', online: local.available },
          ...(broker?.list() ?? [])
            .filter((entry) => allowed.includes(entry.deviceId))
            .map((entry) => ({ id: entry.deviceId, name: entry.name, online: entry.online })),
        ]
      },
    },
    'computer.runtimeDevices': {
      args: z.tuple([]),
      run: () => {
        admin()
        const allowed = allowedRuntimes()
        const seen = new Map((broker?.list() ?? []).map((entry) => [entry.deviceId, entry]))
        return [...new Set([...allowed, ...seen.keys()])].map((deviceId) => ({
          deviceId,
          name: seen.get(deviceId)?.name ?? deviceId,
          online: seen.get(deviceId)?.online ?? false,
          allowed: allowed.includes(deviceId),
        }))
      },
    },
    'computer.allowRuntime': {
      args: z.tuple([id, z.boolean()]),
      run: (deviceId: string, allow: boolean) => {
        const service = admin()
        if (allow && !host.browserGrantEligible?.(deviceId))
          throw new Error('Choose a paired owner device. Viewer pairing grants no computer access.')
        const next = allow
          ? [...new Set([...allowedRuntimes(), deviceId])]
          : allowedRuntimes().filter((entry) => entry !== deviceId)
        workspace.setAppState('computer:runtimes', next)
        if (!allow) {
          broker?.unregister(deviceId)
          for (const task of workspace.listTasks()) {
            const session = service.session(task.id)
            if (session?.runtime.id === deviceId) service.revoke(task.id)
          }
        }
      },
    },
    // The owner's desktop calls these over its authenticated connection; ordinary client calls cannot reach a screen.
    'computerBroker.register': {
      args: z.tuple([z.string().min(1).max(120)]),
      run: (name: string) => {
        const deviceId = brokerDevice()
        broker!.register(deviceId, name)
      },
    },
    'computerBroker.next': {
      args: z.tuple([z.number().int().min(0).max(30_000)]),
      run: (waitMs: number) => broker!.next(brokerDevice(), waitMs),
    },
    'computerBroker.result': {
      args: z.tuple([
        z.string().uuid(),
        z.union([
          z.object({ ok: z.literal(true), value: z.unknown().optional() }),
          z.object({ ok: z.literal(false), error: z.string().max(2000) }),
        ]),
      ]),
      run: (commandId: string, outcome: BrokerOutcome) => broker!.result(brokerDevice(), commandId, outcome),
    },
    'computerBroker.unregister': { args: z.tuple([]), run: () => broker!.unregister(brokerDevice()) },
    // Runs one command from the execution host on this computer's own backend. Local only, and only while enabled here.
    'computer.brokerExec': {
      args: z.tuple([z.custom<BrokerCommand>((value) => typeof value === 'object' && value !== null)]),
      run: async (command: BrokerCommand) => {
        const service = admin()
        if (installingApps) throw new Error('Wait for the Open Computer Use update to finish.')
        if (!enabled()) throw new Error('Computer use is off on this computer.')
        const local = service.backend
        switch (command.kind) {
          case 'capture':
            return local.capture(command.target)
          case 'perform':
            return local.perform(command.target, command.action)
          case 'release':
            return local.releaseInput(command.target)
          case 'apps':
            return local instanceof ComputerRouter ? local.listApps() : []
          case 'localInput':
            return (await local.localInputActive?.(command.target)) === true
        }
      },
    },
    'computer.revoke': { args: z.tuple([id]), run: (threadId: string) => admin().revoke(thread(threadId)) },
    'computer.grantViewer': {
      args: z.tuple([id, id, z.boolean()]),
      run: (threadId: string, deviceId: string, input: boolean) => {
        const service = admin()
        const session = service.session(thread(threadId))
        if (!session) throw new Error('Grant a computer to this thread first.')
        // Input needs a full-access device; a read-only (viewer) device can only ever be given the screen to watch.
        if (input && !host.browserGrantEligible?.(deviceId))
          throw new Error('Choose a paired owner device. A viewer device can only watch.')
        service.grantViewer(threadId, deviceId, input)
      },
    },
    'computer.revokeViewer': {
      args: z.tuple([id, id]),
      run: (threadId: string, deviceId: string) => admin().revokeViewer(thread(threadId), deviceId),
    },
    'computer.viewers': { args: z.tuple([id]), run: (threadId: string) => admin().listViewers(thread(threadId)) },
    'computer.session': { args: z.tuple([id]), run: (threadId: string) => summary(thread(threadId)) },
    'computer.takeControl': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId, true).takeControl(device(), { local: device() === 'local' })
        return summary(threadId)
      },
    },
    // A second device never takes control from the first: it asks, and the device in control answers.
    'computer.requestHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId, true).requestHandoff(device())
        return summary(threadId)
      },
    },
    'computer.approveHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        const session = viewer(threadId, true)
        const requester = session.handoffRequest
        if (requester && !ready().viewerAccess(threadId, requester).input)
          throw new Error('That device is no longer allowed to control this computer.')
        session.approveHandoff(device())
        return summary(threadId)
      },
    },
    'computer.declineHandoff': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        viewer(threadId, true).declineHandoff(device())
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
        viewer(threadId, true).giveToAgent(device(), run.id)
        return summary(threadId)
      },
    },
    'computer.stop': {
      args: z.tuple([id]),
      run: (threadId: string) => {
        const session = viewer(threadId, false)
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
        const { capture, hash, ...meta } = await viewer(threadId, false).view(since, since ? FRAME_WAIT_MS : 0)
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
        const session = viewer(threadId, false)
        if (session.runtime.id !== 'local' || session.target.kind !== 'display')
          throw new Error('Video is available for this computer’s main display. Use image frames for this target.')
        return video.answer(threadId, device(), offer)
      },
    },
    'computer.rtcKeyFrame': {
      args: z.tuple([id, z.string().uuid()]),
      run: (threadId: string, peerId: string) => {
        viewer(threadId, false)
        video?.keyFrame(peerId, device())
      },
    },
    'computer.rtcClose': {
      args: z.tuple([id, z.string().uuid()]),
      run: (_threadId: string, peerId: string) => video?.closeFor(peerId, device()),
    },
    'computer.input': {
      args: z.tuple([id, z.number().int().min(0), z.number(), action]),
      run: (threadId: string, generation: number, capturedAt: number, input: ComputerAction) =>
        viewer(threadId, true).humanInput(device(), generation, { capturedAt }, input),
    },
    'computer.disconnect': {
      args: z.tuple([id]),
      run: (threadId: string) => viewer(threadId, false).controllerDisconnected(device()),
    },
  }
}
