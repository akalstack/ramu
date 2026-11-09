import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ocuToolsDir } from '../computer/ocu'
import { findExecutable } from '../providers/providerBinaries'

/** The fb-idb release Ramu installs and has been checked against. */
export const IDB_VERSION = '1.1.7'
const COMPANION_FORMULA = 'facebook/fb/idb-companion'

const managedDir = () => join(ocuToolsDir(), `idb-${IDB_VERSION}`)
// Double quotes keep spaces intact while $HOME still expands; anything that would expand further is escaped.
const shellPath = (path: string) => {
  const home = homedir()
  const quoted = (value: string) => value.replace(/["$`\\]/g, '\\$&')
  return path.startsWith(home + '/') ? `"$HOME${quoted(path.slice(home.length))}"` : `"${quoted(path)}"`
}

/** The same install as the one-click button, for a person who prefers their own terminal. */
export const idbInstallCommand = () => {
  const dir = shellPath(managedDir())
  return `brew install ${COMPANION_FORMULA} && /usr/bin/python3 -m venv ${dir} && ${dir}/bin/pip install fb-idb==${IDB_VERSION}`
}

// The desktop daemon often starts without Homebrew on PATH, so its prefixes are checked by name.
const find = (name: string) =>
  [name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].map(findExecutable).find((path) => !!path) ?? null

/** Ramu's own pinned client first, then any copy the person installed. */
export const idbExecutable = () => findExecutable(join(managedDir(), 'bin/idb')) ?? find('idb')
/** idb falls back to /usr/local/bin for its companion, which is wrong on Apple silicon, so Ramu passes the path. */
export const idbCompanion = () => find('idb_companion')

type Exec = (file: string, args: string[]) => Promise<string>
const execute: Exec = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
    ),
  )

/** Installs the companion with Homebrew and the pinned client in Ramu's tools folder, never into a system Python. */
export async function installIdb({
  exec = execute,
  brew = find('brew'),
  python = findExecutable('/usr/bin/python3'),
  companion = idbCompanion,
  platform = process.platform,
}: {
  exec?: Exec
  brew?: string | null
  python?: string | null
  companion?: () => string | null
  platform?: NodeJS.Platform
} = {}): Promise<void> {
  if (platform !== 'darwin') throw new Error('iOS Simulators run only on a Mac.')
  if (!companion()) {
    if (!brew) throw new Error('Install Homebrew from brew.sh first, then try again.')
    await exec(brew, ['install', COMPANION_FORMULA])
  }
  const dir = managedDir()
  if (!findExecutable(join(dir, 'bin/idb'))) {
    if (!python) throw new Error('Install the Xcode command line tools with xcode-select --install, then try again.')
    await exec(python, ['-m', 'venv', dir])
    await exec(join(dir, 'bin/pip'), ['install', '--disable-pip-version-check', `fb-idb==${IDB_VERSION}`])
  }
  if (!findExecutable(join(dir, 'bin/idb')) || !companion())
    throw new Error('idb installed without its executables. Try again.')
}
