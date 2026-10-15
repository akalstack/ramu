import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

/** Identifies the daemon code on disk, so a service left running from an older build can be told apart from the current one. */
export function runtimeBuild(daemonPath: string): string {
  try {
    const hash = createHash('sha256')
    // Include shared Vite chunks as well as the entry point; timestamps aren't a version.
    for (const name of readdirSync(dirname(daemonPath))
      .filter((name) => name.endsWith('.js'))
      .sort())
      hash.update(name).update(readFileSync(join(dirname(daemonPath), name)))
    return hash.digest('hex').slice(0, 20)
  } catch {
    return 'unknown'
  }
}
/** Version of the package that ships the server bundle, found by walking up from its entry point. */
export function runtimeVersion(daemonPath: string): string {
  for (let dir = dirname(daemonPath), previous = ''; dir !== previous; previous = dir, dir = dirname(dir)) {
    try {
      const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
      if (typeof version === 'string') return version
    } catch {}
  }
  return process.env.RAMU_APP_VERSION ?? 'development'
}
