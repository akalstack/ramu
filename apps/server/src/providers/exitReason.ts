import type { Readable } from 'node:stream'

/** The last of what a provider process wrote to stderr, kept so a crash or silence can say more than "exited". */
export function recordOutput(stream: Readable | null | undefined, limit = 400): { last(): string } {
  let kept = ''
  stream?.on('data', (chunk: Buffer | string) => {
    kept = (kept + chunk.toString()).slice(-limit)
  })
  return {
    last() {
      const line = kept.trim().split('\n').pop()?.trim()
      return line ? line.slice(0, 200) : ''
    },
  }
}

const NO_INSTRUCTION = new Set<NodeJS.Signals | number | string>(['SIGILL', 132, 3221225501])
const KILLED = new Set<NodeJS.Signals>(['SIGKILL'])
const CRASHED = new Set<NodeJS.Signals>(['SIGSEGV', 'SIGBUS', 'SIGTRAP', 'SIGABRT', 'SIGFPE'])

/**
 * Why a provider process ended, in words a person can act on. A process that dies on startup with an illegal
 * instruction is a build that needs a newer processor than this computer has (older Intel Macs lack AVX2), which
 * "exited (signal)" hides.
 */
export function exitReason(
  name: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  output = '',
  platform: NodeJS.Platform = process.platform,
): string {
  const said = output ? ` Last output: ${output}` : ''
  if ((signal && NO_INSTRUCTION.has(signal)) || (code !== null && NO_INSTRUCTION.has(code)))
    return `${name} crashed with an illegal instruction. This computer's processor is probably too old for this build (older Intel Macs lack AVX2). Install a build for older processors, or use another provider.${said}`
  if (signal && KILLED.has(signal))
    return `${name} was stopped by the system${platform === 'darwin' ? ' (macOS stops programs it does not trust or that use too much memory; check Privacy & Security)' : ' (often out of memory)'}.${said}`
  if (signal && CRASHED.has(signal)) return `${name} crashed (${signal}).${said}`
  if (signal) return `${name} was stopped (${signal}).${said}`
  return `${name} exited (${code ?? 'unknown'}).${said}`
}
