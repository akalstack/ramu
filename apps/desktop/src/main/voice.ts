import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DICTATION_MAX_BYTES } from '@ramu/shared/voice/dictation'
import { UNSUPPORTED_VOICE, createVoiceLease, type VoiceCapability, type VoiceLease } from '@ramu/shared/voice/engine'
import { SYSTEM_LANGUAGE } from '@ramu/shared/voice/settings'
import { pcmToWav, voiceErrorMessage } from '@ramu/shared/voice/bridge'
import SOURCE from '../../native/ramu-speech.swift?raw'

/** Runs the recognizer helper and returns what it printed. A timeout or crash rejects. */
export type SpeechHelper = (args: string[]) => Promise<string>

export interface MicrophoneAccess {
  status(): 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
  ask(): Promise<boolean>
}

export interface DesktopVoiceOptions {
  /** Owned directory for temporary audio and the compiled helper; nothing else is ever read or deleted from it. */
  dir: string
  platform?: NodeJS.Platform
  /** Defaults to the helper compiled from the bundled source. Tests pass a fake. */
  helper?: SpeechHelper
  microphone: MicrophoneAccess
  /** Longest a recognition may run before it is abandoned. */
  timeoutMs?: number
}

const TEMP_PREFIX = 'take-'

const helperName = (source: string) => `ramu-speech-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`

/** Compiles the helper once with the Xcode toolchain, named by its source hash so an update never reuses an old build. */
export function createSpeechHelper(dir: string, timeoutMs: number, source = SOURCE): SpeechHelper {
  const target = join(dir, helperName(source))
  let compiling: Promise<string> | null = null
  const ensure = (): Promise<string> => {
    if (existsSync(target)) return Promise.resolve(target)
    compiling ??= new Promise<string>((resolve, reject) => {
      mkdirSync(dir, { recursive: true })
      const file = `${target}.swift`
      writeFileSync(file, source)
      execFile(
        '/usr/bin/xcrun',
        ['swiftc', '-O', '-swift-version', '5', file, '-o', target],
        { timeout: 240_000, encoding: 'utf8' },
        (error) => {
          rmSync(file, { force: true })
          if (error) reject(new Error(voiceErrorMessage('unavailable')))
          else resolve(target)
        },
      )
    }).finally(() => {
      compiling = null
    })
    return compiling
  }
  return async (args) => {
    const binary = await ensure()
    return new Promise<string>((resolve, reject) =>
      execFile(binary, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        // The helper prints one JSON line even when it fails, so a non-zero exit with output is still an answer.
        if (stdout.trim()) resolve(stdout)
        else reject(error ?? new Error(voiceErrorMessage('recognition')))
      }),
    )
  }
}

interface Take {
  token: string
  owner: number
}

/**
 * The shell's dictation host. Main owns the microphone permission, one recording lease across every window, the
 * temporary audio file and the local recognizer. Renderers only reach it through the trusted window's preload bridge.
 * macOS recognizes with Apple's on-device recognizer; other platforms report unsupported until their adapter passes
 * native acceptance, and typing and system dictation stay usable there.
 */
export class DesktopVoice {
  private readonly lease: VoiceLease = createVoiceLease()
  private take: Take | undefined
  private readonly platform: NodeJS.Platform
  private helper: SpeechHelper | undefined
  private readonly timeoutMs: number

  constructor(private readonly options: DesktopVoiceOptions) {
    this.platform = options.platform ?? process.platform
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.helper = options.helper
  }

  private run(args: string[]): Promise<string> {
    this.helper ??= createSpeechHelper(this.options.dir, this.timeoutMs)
    return this.helper(args)
  }

  /** Temp audio left by a crash or a force quit. Only files this class named are removed. */
  cleanupOrphans() {
    try {
      for (const name of readdirSync(this.options.dir))
        if (name.startsWith(TEMP_PREFIX) && name.endsWith('.wav')) rmSync(join(this.options.dir, name), { force: true })
    } catch {
      /* The directory does not exist yet. */
    }
  }

  async capability(language: string): Promise<VoiceCapability> {
    if (this.platform !== 'darwin') return UNSUPPORTED_VOICE
    try {
      const reply = JSON.parse(await this.run(['capability', language || SYSTEM_LANGUAGE])) as Partial<VoiceCapability>
      const microphone = this.options.microphone.status()
      let readiness = reply.readiness ?? 'unsupported'
      // The recognizer is ready only if the microphone is too; permission is asked when the person starts recording.
      if (readiness === 'ready' || readiness === 'permission-needed') {
        if (microphone === 'denied' || microphone === 'restricted') readiness = 'permission-denied'
        else if (microphone === 'not-determined') readiness = 'permission-needed'
      }
      return {
        readiness,
        languages: Array.isArray(reply.languages) ? reply.languages.filter((tag) => typeof tag === 'string') : [],
        resolvedLanguage: reply.resolvedLanguage,
        onDevice: true,
      }
    } catch {
      return UNSUPPORTED_VOICE
    }
  }

  /** Is this window recording right now? The session permission handler uses it to allow only its own audio capture. */
  holds(owner: number): boolean {
    return this.take?.owner === owner
  }

  async begin(owner: number, language: string): Promise<{ token: string }> {
    if (this.platform !== 'darwin') throw new Error(voiceErrorMessage('unavailable'))
    const status = this.options.microphone.status()
    if (status === 'denied' || status === 'restricted') throw new Error(voiceErrorMessage('permission'))
    const id = randomUUID()
    // One recording per computer: another window holding the microphone refuses this one rather than queueing it.
    if (!this.lease.acquire(id)) throw new Error(voiceErrorMessage('capture'))
    try {
      if (status !== 'granted' && !(await this.options.microphone.ask())) throw new Error(voiceErrorMessage('permission'))
      const capability = await this.capability(language)
      if (capability.readiness === 'permission-needed') {
        const answer = JSON.parse(await this.run(['authorize'])) as { status?: string }
        if (answer.status !== 'authorized') throw new Error(voiceErrorMessage('permission'))
      } else if (capability.readiness === 'permission-denied') throw new Error(voiceErrorMessage('permission'))
      else if (capability.readiness !== 'ready') throw new Error(voiceErrorMessage('language'))
    } catch (error) {
      this.lease.release(id)
      throw error instanceof Error && error.message.startsWith('voice:') ? error : new Error(voiceErrorMessage('unavailable'))
    }
    this.take = { token: id, owner }
    return { token: id }
  }

  /** The take is finished with, one way or another: forget it and let the next recording start. */
  private finish(token: string) {
    if (this.take?.token === token) this.take = undefined
    this.lease.release(token)
  }

  async transcribe(owner: number, token: string, pcm: Uint8Array, language: string): Promise<string> {
    const take = this.take
    if (!take || take.token !== token || take.owner !== owner) throw new Error(voiceErrorMessage('capture'))
    // Audio is bounded like the recording itself; anything larger did not come from the capture adapter.
    if (pcm.byteLength === 0 || pcm.byteLength > DICTATION_MAX_BYTES + 64_000) {
      this.finish(token)
      throw new Error(voiceErrorMessage('empty'))
    }
    mkdirSync(this.options.dir, { recursive: true })
    const file = join(this.options.dir, `${TEMP_PREFIX}${token}.wav`)
    try {
      writeFileSync(file, pcmToWav(pcm), { mode: 0o600 })
      let reply: { text?: string; error?: string }
      try {
        reply = JSON.parse(await this.run(['transcribe', file, language || SYSTEM_LANGUAGE]))
      } catch {
        throw new Error(voiceErrorMessage('recognition'))
      }
      if (reply.text) return reply.text
      const reason = ['permission', 'language', 'empty'].includes(reply.error ?? '') ? reply.error! : 'recognition'
      throw new Error(`voice:${reason}`)
    } finally {
      rmSync(file, { force: true })
      this.finish(token)
    }
  }

  cancel(owner: number, token: string) {
    if (this.take?.token === token && this.take.owner === owner) this.finish(token)
  }

  /** A window closed or crashed: its recording ends and its lease goes. */
  release(owner: number) {
    if (this.take?.owner === owner) this.finish(this.take.token)
  }
}
