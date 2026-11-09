import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  ComputerNotRun,
  type ComputerAction,
  type ComputerBackend,
  type ComputerCapture,
  type ComputerTarget,
} from '@ramu/shared/computerBridge'
import {
  pngSize,
  type PlatformReadiness,
  type TestDeviceLease,
  type TestDeviceModel,
  type TestDeviceOrientation,
  type TestDeviceStatus,
  type TestDeviceWaiting,
  type TestPlatform,
} from '@ramu/shared/testDevices'
import { redactSecrets } from '../memory/secrets'
import { AgentDeviceSession, elementsText, type DeviceElement } from './agentDevice'
import {
  AGENT_DEVICE_VERSION,
  installSimlock,
  simlock,
  simlockBytes,
  SimlockHost,
  simlockInstalled,
  simlockToolDir,
  SIMLOCK_VERSION,
  type SimlockCatalog,
  type SimlockLease,
} from './simlock'

/** The thread's tools for test devices; computer_observe and the action tools then work on the opened device. */
export const TEST_DEVICE_GUIDE = `To check an app on an iOS Simulator or Android emulator, call test_device_open with a platform (and a model and system from test_device_list when one matters). The thread gets a fresh device of its own, kept until the thread lets go, and waits in line while the host is full. Build the app with the project's own commands, install it with test_device_install (a path inside the workspace: a .app for iOS, an .apk for Android) and start it with test_device_launch. Then call computer_observe: it lists the screen's elements, each with a ref and its centre. Tap one with computer_click and its element ref (the point is the fallback), type with computer_type, scroll and drag as on a computer, and use computer_key for Enter, Back and Home. test_device_logs reads the app's recent logs and test_device_rotate turns an iPhone. If the device restarts, Ramu tells you; launch the app again.`

/** One thread's device: its agent-device session, the Simlock lease that session holds, and how to reach the device. */
interface Held {
  taskId: string
  platform: TestPlatform
  session: AgentDeviceSession
  tokenId: string
  /** The thread's own Simlock token, for what only a lease's holder may do. Held in memory only. */
  token: string
  leaseId: string
  /** The simulator UDID or the emulator's adb serial. */
  address: string
  name: string
  since: number
  /** Screenshot pixels per element point, learned from the first capture. */
  scale: number
  /** The first snapshot starts agent-device's runner; it runs right after opening so the agent's first look is quick. */
  warm: Promise<void>
  /** When an agent or a viewer last used it; a device left alone is given back. */
  lastUse: number
}

/** A device nobody has used or watched for this long goes back to Simlock, which deletes it. */
export const TEST_DEVICE_IDLE_MS = 30 * 60_000

interface Opening {
  taskId: string
  platform: TestPlatform
  startedAt: number
  /** Set once the session exists, so Stop waiting can withdraw the request. */
  session?: AgentDeviceSession
}

/** What a thread asks for: a platform, and optionally a model and system from the catalog. */
export interface OpenRequest {
  platform: TestPlatform
  model?: string
  os?: string
}

type CommandRun = (args: string[]) => Promise<string>

/**
 * Test devices on this host, leased per thread from Simlock: each thread gets a fresh device that no other thread
 * touches, waits in Simlock's queue when the host is full, and its device is deleted when it lets go. Agents never get
 * a shell: commands are fixed programs with checked arguments, and app files must come from inside the workspace.
 */
export class TestDevices {
  private held = new Map<string, Held>()
  private opening = new Map<string, Opening>()
  /** Device ids per lease, read when a lease is granted, so a device event finds its thread. */
  private leaseDevice = new Map<string, string>()
  private events: AbortController | null = null
  private timer?: NodeJS.Timeout

  constructor(
    private readonly enabled: () => boolean,
    private readonly options: {
      host?: SimlockHost
      /** The model a thread gets when it names none, as the person chose it. */
      defaults?: () => Partial<Record<TestPlatform, string>>
      /** Whether Simlock keeps a spare device of the kind last used booted and ready. */
      keepWarm?: () => boolean
      /** Tells a thread what happened to its device (a restart, a lost lease) as a system note. */
      notify?: (taskId: string, text: string) => void
      run?: CommandRun
      bytes?: (args: string[]) => Promise<Buffer>
      newSession?: (name: string, token: string) => AgentDeviceSession
      platform?: NodeJS.Platform
      arch?: string
    } = {},
  ) {}

  private get host() {
    this.options.host ??= new SimlockHost(() => ({
      'warmPool.enabled': String(this.options.keepWarm?.() ?? false),
    }))
    return this.options.host
  }

  /** The person turned keeping a spare device ready on or off. */
  async setKeepWarm() {
    if (simlockInstalled()) await this.host.reconfigure()
  }
  private get platform() {
    return this.options.platform ?? process.platform
  }
  private get arch() {
    return this.options.arch ?? process.arch
  }
  private command(args: string[]) {
    return (this.options.run ?? ((list) => simlock(list)))(args)
  }

  /** Once set up, the daemon is prepared at start so the first open does not wait for it. */
  start() {
    if (simlockInstalled() && this.enabled()) void this.host.ready().catch(() => {})
    this.timer = setInterval(() => {
      for (const device of this.held.values())
        if (Date.now() - device.lastUse > TEST_DEVICE_IDLE_MS) void this.releaseThread(device.taskId)
    }, 60_000)
    this.timer.unref?.()
  }

  /** Viewers keep a device in use; reading a frame counts. */
  touch(taskId: string) {
    const device = this.held.get(taskId)
    if (device) device.lastUse = Date.now()
  }

  async stopAll() {
    clearInterval(this.timer)
    this.events?.abort()
    await Promise.all([...this.held.keys()].map((taskId) => this.releaseThread(taskId)))
  }

  /** The install **Set up test devices** runs, for a terminal of the person's own. */
  setupCommand(): string {
    return `npm install --prefix "${simlockToolDir()}" simlock@${SIMLOCK_VERSION} agent-device@${AGENT_DEVICE_VERSION}`
  }

  /** Installs the pinned Simlock and agent-device and starts the daemon with Ramu's settings. */
  async setUp() {
    if (this.platform === 'win32') throw new Error('Test devices run on macOS and Linux hosts.')
    await installSimlock()
    await this.host.ready()
  }

  private unsupported(platform: TestPlatform): string | undefined {
    if (this.platform === 'win32') return 'Test devices run on macOS and Linux hosts.'
    if (platform === 'ios' && this.platform !== 'darwin') return 'iOS Simulators run only on a Mac.'
    if (platform === 'ios' && this.arch !== 'arm64') return 'iOS Simulators here need a Mac with Apple silicon.'
    return undefined
  }

  async readiness(): Promise<Record<TestPlatform, PlatformReadiness>> {
    const findings = simlockInstalled() ? await this.host.doctor().catch(() => []) : []
    const readiness = (platform: TestPlatform): PlatformReadiness => {
      const unsupported = this.unsupported(platform)
      if (unsupported) return { ready: false, unsupported, missing: [] }
      const missing = simlockInstalled()
        ? findings
            .filter((finding) => finding.platform === platform || finding.platform === null)
            .map((finding) => ({ item: finding.item, fix: finding.remedy ?? finding.message }))
        : [{ item: 'Simlock', fix: 'Press Set up test devices.' }]
      return { ready: !missing.length, missing }
    }
    return { ios: readiness('ios'), android: readiness('android') }
  }

  /** Models with an installed system to run on, and the phone each platform picks by itself. */
  private async catalog(): Promise<{
    models: Record<TestPlatform, TestDeviceModel[]>
    phones: Record<TestPlatform, string | null>
  }> {
    const empty = { models: { ios: [], android: [] }, phones: { ios: null, android: null } }
    if (!simlockInstalled()) return empty
    const catalog = await this.host.catalog().catch((): SimlockCatalog => ({}))
    const entry = (platform: TestPlatform) => catalog.platforms?.find((candidate) => candidate.platform === platform)
    const models = (platform: TestPlatform): TestDeviceModel[] => {
      const found = entry(platform)
      if (!found) return []
      return found.models
        .map((name) => ({
          name,
          kind: found.modelClasses?.[name] ?? 'phone',
          systems: [...(found.modelRuntimes?.[name] ?? [])].sort((a, b) =>
            b.localeCompare(a, undefined, { numeric: true }),
          ),
        }))
        .filter((model) => model.systems.length)
    }
    return {
      models: { ios: models('ios'), android: models('android') },
      phones: {
        ios: entry('ios')?.classDefaults?.phone ?? null,
        android: entry('android')?.classDefaults?.phone ?? null,
      },
    }
  }

  async status(): Promise<TestDeviceStatus> {
    const installed = simlockInstalled()
    const [ready, { models, phones }, waiting] = await Promise.all([this.readiness(), this.catalog(), this.waiting()])
    const chosen = this.options.defaults?.() ?? {}
    // A chosen model that cannot run here any more falls back to the platform's own phone.
    const runnable = (which: TestPlatform, name: string | null | undefined) =>
      name && models[which].some((model) => model.name === name) ? name : null
    const fallback = (which: TestPlatform) =>
      runnable(which, chosen[which]) ??
      runnable(which, phones[which]) ??
      models[which].find((model) => model.kind === 'phone')?.name ??
      null
    return {
      enabled: this.enabled(),
      installed,
      setupCommand: this.setupCommand(),
      ...ready,
      inUse: [...this.held.values()].map((device): TestDeviceLease => ({
        taskId: device.taskId,
        platform: device.platform,
        name: device.name,
        since: device.since,
      })),
      waiting,
      models,
      defaults: { ios: fallback('ios'), android: fallback('android') },
      keepWarm: this.options.keepWarm?.() ?? false,
    }
  }

  /**
   * Threads opening a device, each with its place in Simlock's queue. Simlock names a front request by an id of its
   * own, so waiting requests are matched to opening threads per platform in the order both began.
   */
  async waiting(): Promise<TestDeviceWaiting[]> {
    if (!this.opening.size) return []
    const queue = await this.host
      .status()
      .then((status) => status.waiting)
      .catch(() => [])
    const result: TestDeviceWaiting[] = []
    for (const platform of ['ios', 'android'] as const) {
      const threads = [...this.opening.values()]
        .filter((entry) => entry.platform === platform)
        .sort((a, b) => a.startedAt - b.startedAt)
      const requests = queue
        .filter((entry) => (entry as { spec?: { platform?: string } }).spec?.platform === platform)
        .sort((a, b) => ((a as { createdAt?: number }).createdAt ?? 0) - ((b as { createdAt?: number }).createdAt ?? 0))
      threads.forEach((thread, index) => {
        const request = requests[index] as { stage?: string; queuePosition?: number } | undefined
        result.push({
          taskId: thread.taskId,
          platform,
          position: request?.stage === 'queued' ? (request.queuePosition ?? null) : null,
        })
      })
    }
    return result
  }

  /** A thread's place while it waits, for its device pill; null once it has a device or is not waiting. */
  async placeOf(taskId: string): Promise<TestDeviceWaiting | null> {
    if (!this.opening.has(taskId)) return null
    return (await this.waiting()).find((entry) => entry.taskId === taskId) ?? null
  }

  /**
   * Gives the thread a fresh device of its own, waiting in line while the host is full. A thread holds one device at a
   * time: asking for another platform lets the first one go.
   */
  async open(taskId: string, request: OpenRequest): Promise<{ name: string; platform: TestPlatform }> {
    if (!this.enabled())
      throw new Error('Test devices are turned off on this host. Turn them on in Settings → Test devices.')
    if (!simlockInstalled()) throw new Error('Test devices are not set up on this host. Ask the person to set them up.')
    const unsupported = this.unsupported(request.platform)
    if (unsupported) throw new Error(unsupported)
    const existing = this.held.get(taskId)
    if (existing?.platform === request.platform && (!request.model || existing.name.startsWith(request.model)))
      return { name: existing.name, platform: existing.platform }
    if (existing) await this.releaseThread(taskId)
    if (this.opening.has(taskId)) throw new Error('This thread is already waiting for a device.')
    await this.host.ready()
    this.opening.set(taskId, { taskId, platform: request.platform, startedAt: Date.now() })
    const token = await this.host.createToken('agent', `ramu ${taskId}`)
    const session = (this.options.newSession ?? ((name, secret) => new AgentDeviceSession(name, secret)))(
      `ramu-${createHash('sha256').update(taskId).digest('hex').slice(0, 16)}`,
      token.secret,
    )
    const opening = this.opening.get(taskId)
    if (opening) opening.session = session
    try {
      await session.connect()
      const model = request.model ?? (await this.status()).defaults[request.platform] ?? undefined
      const opened = await session.open({
        platform: request.platform,
        ...(model ? { model } : {}),
        ...(request.os ? { os: request.os } : {}),
      })
      const response = await this.host.request('/v1/leases')
      const leases = response.ok ? ((await response.json()) as { leases: SimlockLease[] }).leases : []
      const lease = leases.find((entry) => entry.ownerId === token.id)
      const address = opened.device_udid ?? opened.serial ?? opened.id
      if (!lease || !address) throw new Error('Simlock gave the device back before Ramu could use it. Try again.')
      const spec = opened.lease?.device
      const name = `${spec?.model ?? model ?? (request.platform === 'ios' ? 'iPhone' : 'Android phone')}${spec?.osVersion ? ` · ${request.platform === 'ios' ? 'iOS' : 'Android'} ${spec.osVersion}` : ''}`
      const held: Held = {
        taskId,
        platform: request.platform,
        session,
        tokenId: token.id,
        token: token.secret,
        leaseId: lease.id,
        address,
        name,
        since: Date.now(),
        lastUse: Date.now(),
        scale: request.platform === 'ios' ? 3 : 1,
        warm: session.snapshot().then(
          () => {},
          () => {},
        ),
      }
      this.held.set(taskId, held)
      this.leaseDevice.set(lease.id, lease.deviceId)
      this.follow()
      return { name, platform: request.platform }
    } catch (error) {
      await session.close()
      await this.host.revokeToken(token.id)
      throw error
    } finally {
      this.opening.delete(taskId)
    }
  }

  /** The thread's device, or a refusal naming what to do first. */
  private heldBy(taskId: string): Held {
    const device = this.held.get(taskId)
    if (!device) throw new Error('Open a test device first with test_device_open.')
    device.lastUse = Date.now()
    return device
  }

  /** A thread ended, stopped or was archived, or the person pressed Stop: its device is given back and deleted. */
  async releaseThread(taskId: string) {
    // A thread still in line withdraws its request: closing its session cancels it, and its open then fails.
    await this.opening.get(taskId)?.session?.close()
    const device = this.held.get(taskId)
    if (!device) return
    this.held.delete(taskId)
    this.leaseDevice.delete(device.leaseId)
    await device.session.close()
    await this.host.revokeToken(device.tokenId)
  }

  /**
   * Follows Simlock's events while any thread holds a device, so a restarted device or a lease that ended without
   * Ramu reaches its thread as a note instead of as failing taps.
   */
  private follow() {
    if (this.events || !this.options.notify) return
    const controller = new AbortController()
    this.events = controller
    void (async () => {
      try {
        const response = await this.host.request('/v1/events/stream', { signal: controller.signal })
        if (!response.ok || !response.body) return
        const decoder = new TextDecoder()
        let buffer = ''
        const reader = response.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('')
            if (data) this.onEvent(data)
          }
          if (!this.held.size) break
        }
      } catch {
        // The stream ends when the daemon restarts or the last device goes; the next open follows again.
      } finally {
        if (this.events === controller) this.events = null
      }
    })()
  }

  private onEvent(data: string) {
    let event: { event?: string; payload?: { deviceId?: string; leaseId?: string; reason?: string } }
    try {
      event = JSON.parse(data) as typeof event
    } catch {
      return
    }
    const payload = event.payload ?? {}
    for (const device of this.held.values()) {
      if (
        event.event === 'device.recovered' &&
        payload.deviceId &&
        this.leaseDevice.get(device.leaseId) === payload.deviceId
      )
        this.options.notify?.(
          device.taskId,
          `The ${device.platform === 'ios' ? 'simulator' : 'emulator'} restarted after a crash. Launch the app again before going on.`,
        )
      if ((event.event === 'lease.released' || event.event === 'lease.expired') && payload.leaseId === device.leaseId) {
        this.held.delete(device.taskId)
        void this.host.revokeToken(device.tokenId)
        this.options.notify?.(
          device.taskId,
          'The test device was given back and deleted. Open a new one with test_device_open if you still need it.',
        )
      }
    }
  }

  /** An app file from inside the thread's workspace; anything outside it is refused before the device sees it. */
  private async inside(cwd: string, path: string) {
    if (isAbsolute(path)) throw new Error('Give the app path relative to the workspace.')
    const root = await realpath(cwd)
    const full = await realpath(resolve(root, path)).catch(() => {
      throw new Error('That app file does not exist.')
    })
    const from = relative(root, full)
    if (!from || from.startsWith('..') || isAbsolute(from)) throw new Error('The app must be inside the workspace.')
    return full
  }

  async install(taskId: string, cwd: string, path: string) {
    const device = this.heldBy(taskId)
    const full = await this.inside(cwd, path)
    if (device.platform === 'ios') {
      if (!full.endsWith('.app')) throw new Error('An iOS Simulator installs a built .app bundle.')
      await this.command(['simctl', 'install', device.address, full])
    } else {
      if (!full.endsWith('.apk')) throw new Error('An Android emulator installs an .apk file.')
      await this.command(['adb', '-s', device.address, 'install', '-r', full])
    }
    return { installed: true }
  }

  async launch(taskId: string, appId: string) {
    const device = this.heldBy(taskId)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(appId)) throw new Error('Give the bundle identifier or package name.')
    await device.session.command(['open', appId, '--relaunch'], 180_000)
    return { launched: true }
  }

  async openUrl(taskId: string, url: string) {
    const device = this.heldBy(taskId)
    if (!/^[a-z][a-z0-9+.-]*:\S{1,2000}$/i.test(url)) throw new Error('Give a full link, such as myapp://settings.')
    await device.session.command(['open', url, '--platform', device.platform], 180_000)
    return { opened: true }
  }

  /** Recent log lines for the launched app only, bounded, with known secrets removed. */
  async logs(taskId: string, appId: string, lines = 200) {
    const device = this.heldBy(taskId)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(appId)) throw new Error('Give the bundle identifier or package name.')
    const count = Math.min(Math.max(lines, 1), 500)
    let text: string
    if (device.platform === 'ios') {
      text = await this.command([
        'simctl',
        'spawn',
        device.address,
        'log',
        'show',
        '--last',
        '5m',
        '--style',
        'compact',
        '--predicate',
        `subsystem == "${appId}" OR process == "${appId.split('.').pop()}"`,
      ])
    } else {
      const pid = (await this.command(['adb', '-s', device.address, 'shell', 'pidof', appId]).catch(() => '')).trim()
      if (!pid) return { lines: '', note: 'That app is not running.' }
      text = await this.command([
        'adb',
        '-s',
        device.address,
        'logcat',
        '-d',
        '-t',
        String(count),
        `--pid=${pid.split(/\s+/)[0]}`,
      ])
    }
    return { lines: redactSecrets(text.split('\n').slice(-count).join('\n')) }
  }

  /** Turns an iOS Simulator; Simlock refuses an emulator, which reaches the agent in its words. */
  async rotate(taskId: string, orientation: TestDeviceOrientation) {
    const device = this.heldBy(taskId)
    if (device.platform !== 'ios') throw new Error('Only an iOS Simulator turns; an Android emulator does not.')
    const response = await this.host.request(
      `/v1/leases/${encodeURIComponent(device.leaseId)}/rotate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Simlock's HTTP API spells orientations with underscores, its CLI with hyphens.
        body: JSON.stringify({ orientation: orientation.replace(/-/g, '_') }),
      },
      device.token,
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new Error(body?.error?.message ?? 'The simulator did not turn.')
    }
    return { orientation }
  }

  /** The lease's live picture, as Simlock serves it, for the server to pass on to a viewer. */
  async stream(taskId: string): Promise<Response> {
    const device = this.heldBy(taskId)
    return this.host.request(`/v1/leases/${encodeURIComponent(device.leaseId)}/stream`)
  }

  /** A full-size screenshot through Simlock: quicker and sharper than agent-device's own. */
  private async screenshot(device: Held): Promise<Buffer> {
    if (device.platform === 'android')
      return (this.options.bytes ?? simlockBytes)(['adb', '-s', device.address, 'exec-out', 'screencap', '-p'])
    const dir = await mkdtemp(join(tmpdir(), 'ramu-sim-'))
    try {
      const file = join(dir, 'screen.png')
      await this.command(['simctl', 'io', device.address, 'screenshot', '--type=png', file])
      return await readFile(file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** A computer-use backend for the thread's device, so observe, tap, type, viewers and Take control work as they do. */
  backend(taskId: string): ComputerBackend {
    const device = () => {
      const entry = this.held.get(taskId)
      if (!entry) throw new ComputerNotRun('The test device is gone. Open a new one with test_device_open.')
      entry.lastUse = Date.now()
      return entry
    }
    const point = (entry: Held, x: number, y: number) => ({
      x: Math.round(x / entry.scale),
      y: Math.round(y / entry.scale),
    })
    return {
      status: () => ({ available: true, computer: { id: `test-device:${taskId}`, name: this.target(taskId).name } }),
      capture: async (_target, options): Promise<ComputerCapture> => {
        const entry = device()
        const elements: DeviceElement[] = options?.forViewer
          ? []
          : await entry.warm.then(() => entry.session.snapshot()).catch(() => [])
        const bytes = await this.screenshot(entry)
        const size = pngSize(bytes) ?? { width: 0, height: 0 }
        const root = elements.find((element) => element.depth === 0)
        if (root?.rect.width && size.width) entry.scale = size.width / root.rect.width
        const text = elements.length ? elementsText(elements, entry.scale) : ''
        return {
          mimeType: 'image/png',
          data: bytes.toString('base64'),
          ...size,
          scale: entry.scale,
          ...(text ? { text } : {}),
        }
      },
      perform: async (_target: ComputerTarget, action: ComputerAction) => {
        const entry = device()
        // A touch screen has no pointer to follow.
        if (action.kind === 'move') return
        if (action.kind === 'click')
          await entry.session.press(
            action.ref ? { ref: action.ref.replace(/^@/, '') } : point(entry, action.x, action.y),
          )
        else if (action.kind === 'type') await entry.session.type(action.text)
        else if (action.kind === 'key') {
          if (action.key === 'Enter' || action.key === 'Return') await entry.session.command(['keyboard', 'enter'])
          else if (action.key === 'Escape' || action.key === 'Back') await entry.session.back()
          else if (action.key === 'Home') await entry.session.home()
          else throw new ComputerNotRun(`A test device takes Enter, Back and Home, not ${action.key}.`)
        } else if (action.kind === 'scroll')
          await entry.session.swipe(
            point(entry, action.x, action.y),
            point(entry, action.x - action.dx, action.y - action.dy),
          )
        else await entry.session.swipe(point(entry, action.fromX, action.fromY), point(entry, action.toX, action.toY))
      },
      releaseInput: () => {},
      frameInterval: () => 500,
    }
  }

  /** The target shown in the viewer and the live view: the device's own name. */
  target(taskId: string): ComputerTarget {
    return { id: `test-device:${taskId}`, kind: 'display', name: this.held.get(taskId)?.name ?? 'Test device' }
  }

  /** Which platforms are ready, for the host list in Continue on another host. */
  async readyPlatforms(): Promise<TestPlatform[]> {
    if (!this.enabled() || !simlockInstalled()) return []
    const { ios, android } = await this.readiness()
    return [...(ios.ready ? (['ios'] as const) : []), ...(android.ready ? (['android'] as const) : [])]
  }
}
