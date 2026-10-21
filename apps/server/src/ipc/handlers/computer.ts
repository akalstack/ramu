import { z } from 'zod'
import { MAX_COMPUTER_TEXT, type ComputerAction } from '@ramu/shared/computerBridge'
import { MAIN_DISPLAY } from '../../computer/macos'
import { ComputerRouter } from '../../computer/router'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

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
export const registerComputerHandlers: RegisterHandlers = ({ computer, host, workspace, agents }) => {
  const ready = () => {
    if (!computer) throw new Error('Update this host for computer use.')
    return computer
  }
  const admin = () => {
    if (!host.canAdministerIntegrations?.())
      throw new Error('Computer use setup and grants must be reviewed on the owning host.')
    return ready()
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
    return { target: session.target, controller, generation, paused }
  }
  return {
    'computer.status': {
      args: z.tuple([]),
      run: () => ({
        enabled: enabled(),
        runtime: computer ? computer.status() : ({ available: false, reason: 'unsupported' } as const),
        apps: computer?.backend instanceof ComputerRouter ? computer.backend.appStatus() : null,
      }),
    },
    'computer.setEnabled': {
      args: z.tuple([z.boolean()]),
      run: (value: boolean) => {
        const service = admin()
        workspace.setAppState('computer:enabled', value)
        if (!value) for (const task of workspace.listTasks()) service.revoke(task.id)
      },
    },
    'computer.apps': {
      args: z.tuple([]),
      run: async () => {
        const backend = admin().backend
        return backend instanceof ComputerRouter ? backend.listApps() : []
      },
    },
    'computer.grant': {
      args: z.tuple([
        id,
        z.object({ observe: z.boolean(), input: z.boolean(), app: z.string().min(1).max(200).optional() }),
      ]),
      run: async (threadId: string, scope: { observe: boolean; input: boolean; app?: string }) => {
        const service = admin()
        if (!enabled()) throw new Error('Turn on computer use in Settings first.')
        const backend = service.backend
        let target = MAIN_DISPLAY
        if (scope.app !== undefined) {
          if (!(backend instanceof ComputerRouter)) throw new Error('This host cannot limit access to one app.')
          const status = backend.appStatus()
          if (!status.available) throw new Error(status.detail ?? 'App control is not available on this host.')
          // Only an app that is running or recently used can be granted, never an arbitrary string.
          const known = await backend.listApps()
          if (!known.includes(scope.app)) throw new Error(`${scope.app} is not a running or recently used app.`)
          target = { id: `app:${scope.app}`, kind: 'app', name: scope.app }
        } else {
          const status = service.status()
          if (!status.available) throw new Error(status.detail ?? 'Computer use is not available on this host.')
        }
        service.grant(thread(threadId), { target, observe: scope.observe, input: scope.input && scope.observe })
        return summary(threadId)
      },
    },
    'computer.revoke': { args: z.tuple([id]), run: (threadId: string) => admin().revoke(thread(threadId)) },
    'computer.grantViewer': {
      args: z.tuple([id, id, z.boolean()]),
      run: (threadId: string, deviceId: string, input: boolean) => {
        const service = admin()
        const session = service.session(thread(threadId))
        if (!session) throw new Error('Grant a computer to this thread first.')
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
      args: z.tuple([id]),
      run: async (threadId: string) => {
        const { capture, ...meta } = await viewer(threadId, false).view()
        return { ...meta, mimeType: capture.mimeType, data: capture.data }
      },
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
