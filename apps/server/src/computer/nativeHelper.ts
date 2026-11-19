import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ocuToolsDir } from './ocu'

/** Where a compiled helper lives: named by its source hash, so an update recompiles and an old build is never reused. */
export function helperPath(source: string, name: string): string {
  return join(ocuToolsDir(), `${name}-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`)
}

type Run = (file: string, args: string[]) => Promise<string>
const run: Run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 240_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  )

const compiling = new Map<string, Promise<string>>()
/** Compiles a Swift helper once with the Xcode toolchain. Rejects when it is missing so the caller can fall back. */
export function ensureHelper(source: string, name: string, exec: Run = run): Promise<string> {
  const target = helperPath(source, name)
  if (existsSync(target)) return Promise.resolve(target)
  let pending = compiling.get(target)
  if (!pending) {
    pending = (async () => {
      mkdirSync(ocuToolsDir(), { recursive: true })
      const file = `${target}.swift`
      writeFileSync(file, source)
      await exec('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', file, '-o', target])
      return target
    })().finally(() => compiling.delete(target))
    compiling.set(target, pending)
  }
  return pending
}
