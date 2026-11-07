// SSH to the person's own server through the system's OpenSSH client. It is used rather than a JavaScript SSH library
// because OpenSSH is already on every macOS and Linux host, gets security fixes with the operating system, and does
// host key checking itself: Ramu only supplies the pinned key and reads the outcome. Every call is an argument list,
// reads no ssh configuration or agent, and sends one fixed script with its values base64-encoded after it, so nothing
// a person or repository typed is parsed by either shell.
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { redactSecrets } from '../../memory/secrets'
import { DeployError } from './adapter'
import { platformCli } from './signIn'

/** Where to connect and how to prove who Ramu is. `knownHosts` null means first contact: the key is learned. */
export interface SshTarget {
  host: string
  port: number
  user: string
  privateKey: string
  knownHosts: string | null
}

export interface SshResult {
  code: number
  stdout: string
  stderr: string
  /** The known_hosts line the server's key was pinned as. */
  knownHosts: string
}

/** Runs a remote command with `input` on its standard input. Connection failures throw; a script's own exit does not. */
export type SshRunner = (target: SshTarget, command: string, input: string) => Promise<SshResult>

/** A user name OpenSSH and Linux both accept, never starting with a dash. */
export const SSH_USER = /^[a-z_][a-z0-9_.-]{0,31}$/i
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/
const IPV6 = /^[0-9a-f:]{2,39}$/i
const HOST_NAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

/** An IP address or host name, never something ssh could read as an option. */
export function sshHost(input: string): string | null {
  const host = input.trim().replace(/^\[|\]$/g, '')
  if (IPV4.test(host) || (host.includes(':') && IPV6.test(host)) || HOST_NAME.test(host)) return host.toLowerCase()
  return null
}

export const isIpv4 = (host: string) => IPV4.test(host)

const SCRIPT_ARG = 'ramu'

/**
 * The remote command line: a fixed script as one single-quoted `sh -c` argument and each value as `v` plus its base64
 * (so an empty value still takes its place). Base64 has no character a shell treats specially.
 */
export function remoteCommand(script: string, values: readonly string[]): string {
  if (script.includes("'")) throw new Error('A remote script must not contain a single quote.')
  const args = values.map((value) => `v${Buffer.from(value, 'utf8').toString('base64')}`)
  return [`sh -c '${script}'`, SCRIPT_ARG, ...args].join(' ')
}

/** The decoding helper every remote script starts with. */
export const DECODE = 'd() { printf %s "${1#v}" | base64 -d; }'

const sshString = (value: Buffer | string) => {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

const wrap = (text: string, width: number) => text.match(new RegExp(`.{1,${width}}`, 'g'))?.join('\n') ?? ''

/** A new ed25519 key pair in OpenSSH's own formats: the private key file and the authorized_keys line. */
export function generateKeyPair(comment = 'ramu'): { privateKey: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519')
  const jwk = privateKey.export({ format: 'jwk' })
  const seed = Buffer.from(jwk.d!, 'base64url')
  const pub = Buffer.from(jwk.x!, 'base64url')
  const blob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)])
  const check = randomBytes(4)
  let secret = Buffer.concat([
    check,
    check,
    sshString('ssh-ed25519'),
    sshString(pub),
    sshString(Buffer.concat([seed, pub])),
    sshString(comment),
  ])
  // The private section is padded with 1, 2, 3… to the cipher's block size, eight bytes for "none".
  const padding = (8 - (secret.length % 8)) % 8
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: padding }, (_, index) => index + 1))])
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    sshString('none'),
    sshString('none'),
    sshString(''),
    Buffer.from([0, 0, 0, 1]),
    sshString(blob),
    sshString(secret),
  ])
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrap(body.toString('base64'), 70)}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${blob.toString('base64')} ${comment}`,
  }
}

const OPENSSH =
  /^-----BEGIN OPENSSH PRIVATE KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END OPENSSH PRIVATE KEY-----\s*$/
const PEM = /^-----BEGIN (RSA |EC )?PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END (RSA |EC )?PRIVATE KEY-----\s*$/

/**
 * A pasted private key, checked to be one OpenSSH can use without a passphrase (Ramu cannot type one), with its
 * public line when the format carries it.
 */
export function readPrivateKey(input: string): { privateKey: string; publicKey: string | null } {
  const text = `${input.trim()}\n`
  const openssh = OPENSSH.exec(text.trim())
  if (openssh) {
    const body = Buffer.from(openssh[1]!.replace(/\s/g, ''), 'base64')
    const magic = 'openssh-key-v1\0'
    if (body.subarray(0, magic.length).toString('latin1') !== magic) throw new Error('That is not an SSH private key.')
    let offset = magic.length
    const next = () => {
      const length = body.readUInt32BE(offset)
      const value = body.subarray(offset + 4, offset + 4 + length)
      offset += 4 + length
      return value
    }
    try {
      const cipher = next().toString('latin1')
      if (cipher !== 'none') throw new Error('passphrase')
      next()
      next()
      offset += 4
      const blob = next()
      const type = blob.subarray(4, 4 + blob.readUInt32BE(0)).toString('latin1')
      return { privateKey: text, publicKey: `${type} ${blob.toString('base64')}` }
    } catch (error) {
      if (error instanceof Error && error.message === 'passphrase')
        throw new Error('This key has a passphrase. Use a key without one, or let Ramu create a key.', {
          cause: error,
        })
      throw new Error('That is not an SSH private key.', { cause: error })
    }
  }
  if (PEM.test(text.trim())) {
    if (/ENCRYPTED/.test(text))
      throw new Error('This key has a passphrase. Use a key without one, or let Ramu create a key.')
    return { privateKey: text, publicKey: null }
  }
  throw new Error('Paste the whole private key, from -----BEGIN to -----END.')
}

/** The SHA-256 fingerprint of a pinned known_hosts line, as `ssh-keygen -l` prints it. */
export function hostKeyFingerprint(knownHosts: string): string {
  const key = knownHosts
    .split('\n')
    .find((line) => line.trim() && !line.startsWith('#'))
    ?.trim()
    .split(/\s+/)[2]
  if (!key) return ''
  return `SHA256:${createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64').replace(/=+$/, '')}`
}

const OUTPUT_LIMIT = 1024 * 1024
const TIMEOUT_MS = 3 * 60_000

/** Why ssh itself failed (exit 255), in plain words and the shared kinds. */
export function sshFailure(stderr: string, host: string): DeployError {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key .* differs/i.test(stderr))
    return new DeployError(
      `${host} answered with a different server key than the one Ramu pinned. If you rebuilt the server, disconnect it in Settings → Git → Hosting accounts and connect again; otherwise someone may be intercepting the connection.`,
      'missing-permission',
    )
  if (/Permission denied|Too many authentication failures/i.test(stderr))
    return new DeployError(
      `${host} refused Ramu’s key. Add the public key to ~/.ssh/authorized_keys for that user on the server.`,
      'signed-out',
    )
  if (/Could not resolve hostname|Name or service not known/i.test(stderr))
    return new DeployError(`${host} could not be found. Check the server’s address.`, null)
  return new DeployError(`${host} could not be reached over SSH. Check the address, port and firewall.`, null)
}

/** The system `ssh` with a private key file and known_hosts file that exist only for this call. */
export const runSsh: SshRunner = async (target, command, input) => {
  const executable = platformCli('ssh')
  if (!executable) throw new Error('Install the OpenSSH client (ssh) on this host to deploy to your own server.')
  // mkdtemp makes the folder readable only by this user; both files are deleted when the call ends.
  const dir = await mkdtemp(join(tmpdir(), 'ramu-ssh-'))
  const keyFile = join(dir, 'key')
  const knownFile = join(dir, 'known_hosts')
  try {
    await writeFile(keyFile, target.privateKey.endsWith('\n') ? target.privateKey : `${target.privateKey}\n`, {
      mode: 0o600,
    })
    await writeFile(knownFile, target.knownHosts ?? '', { mode: 0o600 })
    const args = [
      '-F',
      'none',
      '-T',
      '-i',
      keyFile,
      ...[
        'IdentitiesOnly=yes',
        'IdentityAgent=none',
        'BatchMode=yes',
        'PasswordAuthentication=no',
        'KbdInteractiveAuthentication=no',
        `UserKnownHostsFile=${knownFile}`,
        'GlobalKnownHostsFile=/dev/null',
        // First contact learns the key; every later call refuses any other.
        `StrictHostKeyChecking=${target.knownHosts ? 'yes' : 'accept-new'}`,
        'HashKnownHosts=no',
        'UpdateHostKeys=no',
        'CheckHostIP=no',
        'ConnectTimeout=15',
        'ServerAliveInterval=15',
        'ServerAliveCountMax=3',
        'ControlMaster=no',
        'ControlPath=none',
        'ForwardAgent=no',
        'ForwardX11=no',
        'ClearAllForwardings=yes',
        'LogLevel=ERROR',
      ].flatMap((option) => ['-o', option]),
      '-p',
      String(target.port),
      '-l',
      target.user,
      '--',
      target.host,
      command,
    ]
    const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(executable, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: Object.fromEntries(
            ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SystemRoot']
              .filter((name) => process.env[name])
              .map((name) => [name, process.env[name]!]),
          ),
        })
        let out = ''
        let err = ''
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          if (out.length < OUTPUT_LIMIT) out += chunk
        })
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          if (err.length < OUTPUT_LIMIT) err += chunk
        })
        const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS)
        child.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (exit) => {
          clearTimeout(timer)
          resolve({ code: exit ?? 255, stdout: out, stderr: err })
        })
        child.stdin.on('error', () => undefined)
        child.stdin.end(input)
      },
    )
    if (code === 255) throw sshFailure(stderr, target.host)
    const knownHosts = target.knownHosts ?? (await readFile(knownFile, 'utf8')).trim()
    return { code, stdout, stderr: redactSecrets(stderr), knownHosts }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
