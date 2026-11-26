import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureToolsOnPath, findExecutable, loginShellPath } from '../src/providers/providerBinaries'

describe.skipIf(process.platform === 'win32')('ensureToolsOnPath', () => {
  let dir = ''
  const keys = ['PATH', 'HOME', 'FNM_DIR', 'NVM_DIR', 'N_PREFIX', 'PNPM_HOME'] as const
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const noShell = async () => []
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ramu-node-path-'))
    // The known folders are under the home folder, where this machine's own Node may be.
    process.env.HOME = dir
    for (const key of ['FNM_DIR', 'NVM_DIR', 'N_PREFIX', 'PNPM_HOME'] as const) delete process.env[key]
  })
  afterEach(() => {
    for (const key of keys)
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    rmSync(dir, { recursive: true, force: true })
  })
  const executable = (path: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '#!/bin/sh\n')
    chmodSync(path, 0o755)
  }
  const fnmNode = () => {
    const bin = join(dir, 'fnm/aliases/default/bin')
    executable(join(bin, 'node'))
    process.env.FNM_DIR = join(dir, 'fnm')
    return bin
  }
  const bareSystem = () => {
    const system = join(dir, 'system')
    mkdirSync(system)
    process.env.PATH = system
    return system
  }

  it("adds a version manager's Node last, so tools that start with env node run from a service", async () => {
    const bin = fnmNode()
    const system = join(dir, 'system')
    mkdirSync(system)
    process.env.PATH = system
    await ensureToolsOnPath(noShell)
    expect(process.env.PATH).toBe([system, bin].join(delimiter))
    // Asking again changes nothing.
    await ensureToolsOnPath(noShell)
    expect(process.env.PATH).toBe([system, bin].join(delimiter))
  })

  it('leaves PATH alone when a node is already on it', async () => {
    fnmNode()
    const system = join(dir, 'system')
    mkdirSync(system)
    writeFileSync(join(system, 'node'), '#!/bin/sh\n')
    chmodSync(join(system, 'node'), 0o755)
    process.env.PATH = system
    await ensureToolsOnPath(noShell)
    expect(process.env.PATH).toBe(system)
  })

  it("finds nvm's default version through its lts alias, not just the newest", async () => {
    const nvm = join(dir, 'nvm')
    for (const version of ['v20.18.0', 'v22.11.0', 'v23.1.0'])
      executable(join(nvm, 'versions/node', version, 'bin/node'))
    mkdirSync(join(nvm, 'alias/lts'), { recursive: true })
    writeFileSync(join(nvm, 'alias/default'), 'lts/*\n')
    writeFileSync(join(nvm, 'alias/lts/*'), 'lts/jod\n')
    writeFileSync(join(nvm, 'alias/lts/jod'), 'v22.11.0\n')
    process.env.NVM_DIR = nvm
    const system = bareSystem()
    await ensureToolsOnPath(noShell)
    expect(process.env.PATH).toBe([system, join(nvm, 'versions/node/v22.11.0/bin')].join(delimiter))
  })

  it("uses nvm's newest version when its default names one that is not installed", async () => {
    const nvm = join(dir, 'nvm')
    for (const version of ['v9.11.2', 'v18.20.4']) executable(join(nvm, 'versions/node', version, 'bin/node'))
    mkdirSync(join(nvm, 'alias'), { recursive: true })
    writeFileSync(join(nvm, 'alias/default'), '16\n')
    process.env.NVM_DIR = nvm
    const system = bareSystem()
    await ensureToolsOnPath(noShell)
    expect(process.env.PATH).toBe([system, join(nvm, 'versions/node/v18.20.4/bin')].join(delimiter))
  })

  it("puts the login shell's folders first, so npm and CLIs resolve as in the person's terminal", async () => {
    const tools = join(dir, 'custom/bin')
    executable(join(tools, 'npm'))
    executable(join(tools, 'ramu-test-cli'))
    // The shell's own Node, so the fallback has nothing to add from wherever this machine keeps one.
    executable(join(tools, 'node'))
    const system = bareSystem()
    expect(findExecutable('ramu-test-cli')).toBeNull()
    await ensureToolsOnPath(async () => [tools, system])
    expect(process.env.PATH).toBe([tools, system].join(delimiter))
    expect(findExecutable('npm')).toBe(join(tools, 'npm'))
    expect(findExecutable('ramu-test-cli')).toBe(join(tools, 'ramu-test-cli'))
    // Asking again adds nothing twice.
    await ensureToolsOnPath(async () => [tools])
    expect(process.env.PATH).toBe([tools, system].join(delimiter))
  })

  it('ends a login shell whose startup files hang', async () => {
    const shell = join(dir, 'shell')
    // Like an interactive shell, it ignores SIGTERM.
    writeFileSync(shell, "#!/bin/sh\ntrap '' TERM\nsleep 30\n")
    chmodSync(shell, 0o755)
    const started = Date.now()
    expect(await loginShellPath(shell, 300)).toEqual([])
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("resolves the shell's per-shell fnm folder to the install, which outlives that shell", async () => {
    const install = join(dir, 'fnm/node-versions/v22.11.0/installation')
    executable(join(install, 'bin/node'))
    executable(join(install, 'bin/npm'))
    const multishell = join(dir, 'fnm_multishells/12345_67890')
    mkdirSync(join(multishell, '..'), { recursive: true })
    symlinkSync(install, multishell)
    const shell = join(dir, 'shell')
    writeFileSync(
      shell,
      `#!/bin/sh\necho 'Welcome back'\necho '__RAMU_PATH__${join(multishell, 'bin')}:relative:${join(dir, 'gone')}:/usr/bin'\n`,
    )
    chmodSync(shell, 0o755)
    const dirs = await loginShellPath(shell)
    expect(dirs).toHaveLength(2)
    expect(dirs[0]).toMatch(/fnm\/node-versions\/v22\.11\.0\/installation\/bin$/)
  })

  it('gives no folders when the login shell fails before answering', async () => {
    const shell = join(dir, 'shell')
    writeFileSync(shell, '#!/bin/sh\nexit 1\n')
    chmodSync(shell, 0o755)
    expect(await loginShellPath(shell)).toEqual([])
  })
})
