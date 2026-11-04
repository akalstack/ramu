import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  ComputerNotRun,
  type ComputerAction,
  type ComputerBackend,
  type ComputerCapture,
  type ComputerTarget,
} from '@ramu/shared/computerBridge'
import {
  androidKeyCode,
  androidText,
  pngSize,
  TEST_DEVICE_IDLE_MS,
  TEST_DEVICE_LIMIT,
  uiTreeText,
  type PlatformReadiness,
  type TestDevice,
  type TestDeviceStatus,
} from '@ramu/shared/testDevices'
import { redactSecrets } from '../memory/secrets'
import { idbCompanion, idbExecutable, idbInstallCommand } from './idb'

const run = promisify(execFile)
const OPTIONS = { timeout: 60_000, maxBuffer: 32_000_000 }

/** The thread's tools for test devices; computer_observe and the action tools then work on the opened device. */
export const TEST_DEVICE_GUIDE = `To check an app on an iOS Simulator or Android emulator, call test_device_list, then test_device_open. Build the app with the project's own commands, install it with test_device_install (a path inside the workspace: a .app for iOS, an .apk for Android), and start it with test_device_launch. Then use computer_observe and the computer action tools on the device; on Android the observation includes the screen's elements with their centres. test_device_logs reads the app's recent logs.`

const sdkRoot = () =>
  [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'),
    join(homedir(), 'Android/Sdk'),
  ].find((path) => !!path && existsSync(path))
const androidTool = (relativePath: string) => {
  const root = sdkRoot()
  const path = root ? join(root, relativePath) : ''
  return path && existsSync(path) ? path : null
}
interface Running {
  platform: 'ios' | 'android'
  /** The simulator UDID or the adb serial. */
  handle: string
  name: string
  heldBy: string
  lastUse: number
  /** An emulator this service started; it is stopped with the device. */
  process?: ChildProcess
  /** Booted by Ramu, so Ramu shuts it down; a device the person already had running is left running. */
  owned: boolean
}

/**
 * Lifecycle, ownership and the agent-facing operations for test devices. Agents never get a shell: every command is a
 * fixed program with checked arguments, and app files must come from inside the thread's workspace.
 */
export class TestDevices {
  private running = new Map<string, Running>()
  private timer?: NodeJS.Timeout

  constructor(
    private readonly enabled: () => boolean,
    private readonly platform = process.platform,
    private readonly arch = process.arch,
  ) {}

  start() {
    this.timer = setInterval(() => void this.shutdownIdle(), 60_000)
    this.timer.unref?.()
  }

  async stopAll() {
    clearInterval(this.timer)
    await Promise.all([...this.running.keys()].map((id) => this.stop(id).catch(() => {})))
  }

  async readiness(): Promise<{ ios: PlatformReadiness; android: PlatformReadiness }> {
    const ios: PlatformReadiness = { ready: false, missing: [] }
    if (this.platform !== 'darwin') ios.missing.push({ item: 'macOS', fix: 'iOS Simulators run only on a Mac.' })
    else {
      if (this.arch !== 'arm64')
        ios.missing.push({ item: 'Apple silicon', fix: 'Use a Mac with Apple silicon for iOS Simulators.' })
      const xcode = await run('/usr/bin/xcrun', ['simctl', 'help'], { timeout: 10_000 }).then(
        () => true,
        () => false,
      )
      if (!xcode)
        ios.missing.push({
          item: 'Xcode',
          fix: 'Install Xcode from the App Store, open it once, then run xcode-select --install.',
        })
      if (!idbExecutable() || !idbCompanion()) {
        ios.note = 'Watching works. To let agents tap and type, install idb.'
        ios.install = idbInstallCommand()
      }
    }
    ios.ready = !ios.missing.length
    const android: PlatformReadiness = { ready: false, missing: [] }
    if (!androidTool('platform-tools/adb'))
      android.missing.push({
        item: 'Android SDK',
        fix: 'Install Android Studio, or the command-line tools with platform-tools, and set ANDROID_HOME.',
      })
    if (!androidTool('emulator/emulator'))
      android.missing.push({
        item: 'Android emulator',
        fix: 'Install the Emulator package in Android Studio → SDK Manager.',
      })
    android.ready = !android.missing.length
    return { ios, android }
  }

  async status(): Promise<TestDeviceStatus> {
    const [ready, devices] = await Promise.all([this.readiness(), this.list()])
    return { enabled: this.enabled(), ...ready, devices }
  }

  async list(): Promise<TestDevice[]> {
    const devices: TestDevice[] = []
    if (this.platform === 'darwin') {
      const json = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'available', '-j'], OPTIONS).then(
        ({ stdout }) =>
          JSON.parse(stdout) as { devices: Record<string, { udid: string; name: string; state: string }[]> },
        () => ({ devices: {} }),
      )
      for (const [runtime, list] of Object.entries(json.devices)) {
        const system = /iOS-(\d+)(?:-(\d+))?/.exec(runtime)
        if (!system) continue
        for (const device of list)
          devices.push({
            id: device.udid,
            platform: 'ios',
            name: `${device.name} · iOS ${system[1]}${system[2] && system[2] !== '0' ? `.${system[2]}` : ''}`,
            running: device.state === 'Booted',
            heldBy: this.running.get(device.udid)?.heldBy ?? null,
          })
      }
    }
    const emulator = androidTool('emulator/emulator')
    if (emulator) {
      const avds = await run(emulator, ['-list-avds'], OPTIONS).then(
        ({ stdout }) =>
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('INFO')),
        () => [] as string[],
      )
      for (const avd of avds) {
        const id = `avd:${avd}`
        devices.push({
          id,
          platform: 'android',
          name: `${avd.replace(/_/g, ' ')} · Android`,
          running: this.running.has(id),
          heldBy: this.running.get(id)?.heldBy ?? null,
        })
      }
    }
    return devices
  }

  private held(id: string, taskId: string): Running {
    const device = this.running.get(id)
    if (!device) throw new Error('Open that test device first with test_device_open.')
    if (device.heldBy !== taskId) throw new Error('Another thread is using that test device.')
    device.lastUse = Date.now()
    return device
  }

  /** Boots the device for this thread, waiting until it is ready. One thread holds a device at a time. */
  async open(id: string, taskId: string): Promise<{ id: string; name: string }> {
    if (!this.enabled())
      throw new Error('Test devices are turned off on this host. Turn them on in Settings → Computer use.')
    const existing = this.running.get(id)
    if (existing) {
      if (existing.heldBy !== taskId) throw new Error('Another thread is using that test device.')
      existing.lastUse = Date.now()
      return { id, name: existing.name }
    }
    const device = (await this.list()).find((entry) => entry.id === id)
    if (!device) throw new Error('No test device has that id. Call test_device_list.')
    if ([...this.running.values()].filter((entry) => entry.owned).length >= TEST_DEVICE_LIMIT)
      throw new Error(`${TEST_DEVICE_LIMIT} test devices are already running on this host. Stop one first.`)
    if (device.platform === 'ios') {
      const owned = !device.running
      if (owned)
        await run('/usr/bin/xcrun', ['simctl', 'boot', id], OPTIONS).catch((error) => {
          if (!/current state: Booted/.test(String(error))) throw error
        })
      await run('/usr/bin/xcrun', ['simctl', 'bootstatus', id, '-b'], { ...OPTIONS, timeout: 180_000 })
      this.running.set(id, {
        platform: 'ios',
        handle: id,
        name: device.name,
        heldBy: taskId,
        lastUse: Date.now(),
        owned,
      })
      return { id, name: device.name }
    }
    const emulator = androidTool('emulator/emulator')!
    const adb = androidTool('platform-tools/adb')!
    const before = new Set(await this.serials(adb))
    const child = spawn(emulator, ['-avd', id.slice(4), '-no-window', '-no-audio', '-no-boot-anim'], {
      stdio: 'ignore',
      detached: false,
    })
    const serial = await this.waitForSerial(adb, before, child)
    await this.waitForBoot(adb, serial)
    this.running.set(id, {
      platform: 'android',
      handle: serial,
      name: device.name,
      heldBy: taskId,
      lastUse: Date.now(),
      process: child,
      owned: true,
    })
    return { id, name: device.name }
  }

  private async serials(adb: string) {
    const { stdout } = await run(adb, ['devices'], OPTIONS)
    return stdout
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t')[0]!.trim())
      .filter((serial) => serial.startsWith('emulator-'))
  }

  private async waitForSerial(adb: string, before: Set<string>, child: ChildProcess): Promise<string> {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null)
        throw new Error('The emulator stopped while starting. Open it once in Android Studio to see why.')
      const serial = (await this.serials(adb)).find((entry) => !before.has(entry))
      if (serial) return serial
      await new Promise((done) => setTimeout(done, 1000))
    }
    child.kill()
    throw new Error('The emulator did not start in time.')
  }

  private async waitForBoot(adb: string, serial: string) {
    for (let attempt = 0; attempt < 180; attempt++) {
      const { stdout } = await run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], OPTIONS).catch(
        () => ({ stdout: '' }),
      )
      if (stdout.trim() === '1') return
      await new Promise((done) => setTimeout(done, 1000))
    }
    throw new Error('The emulator did not finish booting in time.')
  }

  /** Stops a device Ramu started; one the person was already running is only released. */
  async stop(id: string) {
    const device = this.running.get(id)
    if (!device) return
    this.running.delete(id)
    if (!device.owned) return
    if (device.platform === 'ios')
      await run('/usr/bin/xcrun', ['simctl', 'shutdown', device.handle], OPTIONS).catch(() => {})
    else {
      const adb = androidTool('platform-tools/adb')
      if (adb) await run(adb, ['-s', device.handle, 'emu', 'kill'], OPTIONS).catch(() => {})
      device.process?.kill()
    }
  }

  /** A thread ended or stopped: its devices are released and the ones Ramu started shut down. */
  async releaseThread(taskId: string) {
    for (const [id, device] of this.running) if (device.heldBy === taskId) await this.stop(id)
  }

  /** Emulators this service started, for Resources; simulators run inside the system's own service and are not counted. */
  processes(): { pid: number; taskId: string; id: string; name: string }[] {
    return [...this.running].flatMap(([id, device]) =>
      device.process?.pid ? [{ pid: device.process.pid, taskId: device.heldBy, id, name: device.name }] : [],
    )
  }

  /** Viewers keep a device awake; reading a frame counts as use. */
  touch(id: string) {
    const device = this.running.get(id)
    if (device) device.lastUse = Date.now()
  }

  private async shutdownIdle() {
    for (const [id, device] of this.running) if (Date.now() - device.lastUse > TEST_DEVICE_IDLE_MS) await this.stop(id)
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

  async install(id: string, taskId: string, cwd: string, path: string) {
    const device = this.held(id, taskId)
    const full = await this.inside(cwd, path)
    if (device.platform === 'ios') {
      if (!full.endsWith('.app')) throw new Error('An iOS Simulator installs a built .app bundle.')
      await run('/usr/bin/xcrun', ['simctl', 'install', device.handle, full], OPTIONS)
    } else {
      if (!full.endsWith('.apk')) throw new Error('An Android emulator installs an .apk file.')
      await run(androidTool('platform-tools/adb')!, ['-s', device.handle, 'install', '-r', full], {
        ...OPTIONS,
        timeout: 180_000,
      })
    }
    return { installed: true }
  }

  async launch(id: string, taskId: string, appId: string) {
    const device = this.held(id, taskId)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(appId)) throw new Error('Give the bundle identifier or package name.')
    if (device.platform === 'ios') await run('/usr/bin/xcrun', ['simctl', 'launch', device.handle, appId], OPTIONS)
    else
      await run(
        androidTool('platform-tools/adb')!,
        ['-s', device.handle, 'shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'],
        OPTIONS,
      )
    return { launched: true }
  }

  async openUrl(id: string, taskId: string, url: string) {
    const device = this.held(id, taskId)
    if (!/^[a-z][a-z0-9+.-]*:\S{1,2000}$/i.test(url)) throw new Error('Give a full link, such as myapp://settings.')
    if (device.platform === 'ios') await run('/usr/bin/xcrun', ['simctl', 'openurl', device.handle, url], OPTIONS)
    else
      await run(
        androidTool('platform-tools/adb')!,
        ['-s', device.handle, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url],
        OPTIONS,
      )
    return { opened: true }
  }

  /** Recent log lines for the launched app only, bounded, with known secrets removed. */
  async logs(id: string, taskId: string, appId: string, lines = 200) {
    const device = this.held(id, taskId)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(appId)) throw new Error('Give the bundle identifier or package name.')
    const count = Math.min(Math.max(lines, 1), 500)
    let text: string
    if (device.platform === 'ios') {
      const { stdout } = await run(
        '/usr/bin/xcrun',
        [
          'simctl',
          'spawn',
          device.handle,
          'log',
          'show',
          '--last',
          '5m',
          '--style',
          'compact',
          '--predicate',
          `subsystem == "${appId}" OR process == "${appId.split('.').pop()}"`,
        ],
        OPTIONS,
      )
      text = stdout
    } else {
      const adb = androidTool('platform-tools/adb')!
      const { stdout: pid } = await run(adb, ['-s', device.handle, 'shell', 'pidof', appId], OPTIONS).catch(() => ({
        stdout: '',
      }))
      if (!pid.trim()) return { lines: '', note: 'That app is not running.' }
      const { stdout } = await run(
        adb,
        ['-s', device.handle, 'logcat', '-d', '-t', String(count), `--pid=${pid.trim().split(/\s+/)[0]}`],
        OPTIONS,
      )
      text = stdout
    }
    return { lines: redactSecrets(text.split('\n').slice(-count).join('\n')) }
  }

  /** A computer-use backend for one held device, so observe, tap, type, viewers and Take control all work as they do. */
  backend(id: string): ComputerBackend {
    const device = () => {
      const entry = this.running.get(id)
      if (!entry) throw new ComputerNotRun('The test device is not running. Open it again.')
      entry.lastUse = Date.now()
      return entry
    }
    // iOS input is in points, captures in pixels; recent iPhones and iPads draw three or two pixels per point.
    let scale = 3
    return {
      status: () => ({ available: true, computer: { id: `test-device:${id}`, name: this.target(id).name } }),
      capture: async (): Promise<ComputerCapture> => {
        const entry = device()
        if (entry.platform === 'ios') {
          const dir = await mkdtemp(join(tmpdir(), 'ramu-sim-'))
          try {
            const file = join(dir, 'screen.png')
            await run('/usr/bin/xcrun', ['simctl', 'io', entry.handle, 'screenshot', '--type=png', file], OPTIONS)
            const bytes = await readFile(file)
            const size = pngSize(bytes) ?? { width: 0, height: 0 }
            scale = size.width >= 1000 ? 3 : 2
            return { mimeType: 'image/png', data: bytes.toString('base64'), ...size, scale }
          } finally {
            await rm(dir, { recursive: true, force: true })
          }
        }
        const adb = androidTool('platform-tools/adb')!
        const { stdout } = await run(adb, ['-s', entry.handle, 'exec-out', 'screencap', '-p'], {
          ...OPTIONS,
          encoding: 'buffer',
        })
        const bytes = stdout as unknown as Buffer
        const size = pngSize(bytes) ?? { width: 0, height: 0 }
        const tree = await run(adb, ['-s', entry.handle, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], OPTIONS).then(
          ({ stdout: xml }) => uiTreeText(xml),
          () => '',
        )
        return {
          mimeType: 'image/png',
          data: bytes.toString('base64'),
          ...size,
          scale: 1,
          ...(tree ? { text: tree } : {}),
        }
      },
      perform: async (_target: ComputerTarget, action: ComputerAction) => {
        const entry = device()
        if (entry.platform === 'android') {
          const adb = androidTool('platform-tools/adb')!
          const input = (...args: string[]) => run(adb, ['-s', entry.handle, 'shell', 'input', ...args], OPTIONS)
          const n = (value: number) => String(Math.round(value))
          if (action.kind === 'click') await input('tap', n(action.x), n(action.y))
          else if (action.kind === 'type') await input('text', androidText(action.text))
          else if (action.kind === 'key') {
            const code = androidKeyCode(action.key)
            if (code === null) throw new ComputerNotRun(`The emulator has no ${action.key} key.`)
            await input('keyevent', String(code))
          } else if (action.kind === 'scroll')
            await input('swipe', n(action.x), n(action.y), n(action.x - action.dx), n(action.y - action.dy), '300')
          else await input('swipe', n(action.fromX), n(action.fromY), n(action.toX), n(action.toY), '600')
          return
        }
        const path = idbExecutable()
        const companion = idbCompanion()
        if (!path || !companion)
          throw new ComputerNotRun(
            'Tapping an iOS Simulator needs idb. Install it in Settings › Computer use › Test devices.',
          )
        const ui = (...args: string[]) =>
          run(path, ['--companion-path', companion, 'ui', ...args, '--udid', entry.handle], OPTIONS)
        const p = (value: number) => String(Math.round(value / scale))
        if (action.kind === 'click') await ui('tap', p(action.x), p(action.y))
        else if (action.kind === 'type') await ui('text', action.text)
        else if (action.kind === 'key') {
          if (action.key !== 'Enter' && action.key !== 'Return')
            throw new ComputerNotRun(`The simulator takes Enter, not ${action.key}.`)
          await ui('key', '40')
        } else if (action.kind === 'scroll')
          await ui('swipe', p(action.x), p(action.y), p(action.x - action.dx), p(action.y - action.dy))
        else await ui('swipe', p(action.fromX), p(action.fromY), p(action.toX), p(action.toY))
      },
      releaseInput: () => {},
      frameInterval: () => 500,
    }
  }

  /** The target shown in the viewer and the live view: the device's own name. */
  target(id: string): ComputerTarget {
    const device = this.running.get(id)
    return { id, kind: 'display', name: device?.name ?? 'Test device' }
  }

  /** Which platforms are ready, for the host list in Continue on another host. */
  async readyPlatforms(): Promise<('ios' | 'android')[]> {
    if (!this.enabled()) return []
    const { ios, android } = await this.readiness()
    return [...(ios.ready ? (['ios'] as const) : []), ...(android.ready ? (['android'] as const) : [])]
  }
}
