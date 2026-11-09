// This host's side of the optional Ramu account: sign-in by device code, settings backups sealed here before they go
// to the account or to the person's own GitHub, the recovery code, handing the backup key to a new device after both
// screens show the same number, restore, and listing this host under Your hosts so a signed-in device can ask to pair
// without a code. The account never grants access: pairing still ends with the person approving here.
import { randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  ACCOUNT_LIMITS,
  ACCOUNT_URL,
  type AccountSignIn,
  type AccountStatus,
  type AccountUser,
  type BackupSlotInfo,
  type KeyRequestInfo,
  type ListedHostInfo,
  type RestoreChoice,
} from '@ramu/shared/account'
import {
  SEALED_DEFLATE,
  SealError,
  exchangeCommit,
  exchangeKeys,
  exchangeSecrets,
  fromBase64,
  newBackupKey,
  newRecoveryCode,
  open,
  recoveryKey,
  seal,
  toBase64,
  type ExchangeKeys,
} from '@ramu/shared/accountCrypto'
import { settingsExportSchema, type SettingsExport } from '@ramu/shared/settingsTransfer'
import { HostCredentialStore } from '../credentials/store'
import { SavedCredential } from '../workspace/forge/savedCredential'

const STATE_KEY = 'account:v1'
const random = (bytes: number) => new Uint8Array(randomBytes(bytes))
const GIST_FILE = 'ramu-settings.sealed'
const GIST_RECOVERY = 'ramu-recovery.sealed'

interface State {
  user: AccountUser | null
  /** This host's backup slot: random, so the service learns nothing from it. */
  slot: string
  account: boolean
  github: boolean
  gistId: string | null
  lastBackupAt: number | null
  error: string | null
  listedId: string | null
}

export interface AccountHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  hostName(): string
  /** This host's id, which a listed host is known by. */
  hostId: string
  /** Every portable settings group, as Export settings writes them. */
  exportSettings(): Promise<SettingsExport>
  githubToken(): Promise<string | null>
  /** A relayed pairing message, answered as the host answers a nearby device's. */
  pairing(peer: string, path: string, body: unknown): Promise<{ status: number; body: unknown }>
  changed(): void
  credentials?: HostCredentialStore
  fetch?: typeof fetch
  url?: string
}

export class AccountService {
  private readonly session: SavedCredential<{ token: string }>
  private readonly key: SavedCredential<{ token: string }>
  private readonly fetcher: typeof fetch
  private readonly url: string
  private signing: { started: AccountSignIn; deviceCode: string; interval: number; client: string } | null = null
  private backupTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  /** This host asking another device for the backup key. */
  private asking: { id: string; keys: ExchangeKeys; code: string | null; done: boolean; error: string | null } | null =
    null
  /** Requests this host is answering, with its half of each exchange. */
  private answering = new Map<string, ExchangeKeys>()

  constructor(private readonly host: AccountHost) {
    const credentials = host.credentials ?? new HostCredentialStore()
    const get = (key: string, fallback: unknown) => host.getState(key, fallback) as never
    const set = (key: string, value: unknown) => host.setState(key, value)
    this.session = new SavedCredential(
      { key: 'account-session', connectionId: 'account-session', shown: 'token' },
      get,
      set,
      credentials,
    )
    this.key = new SavedCredential(
      { key: 'account-backup-key', connectionId: 'account-backup-key', shown: 'token' },
      get,
      set,
      credentials,
    )
    this.fetcher = host.fetch ?? fetch
    this.url = (host.url ?? process.env.RAMU_ACCOUNT_URL ?? ACCOUNT_URL).replace(/\/$/, '')
  }

  private state(): State {
    const saved = this.host.getState<Partial<State> | null>(STATE_KEY, null)
    const state: State = {
      user: saved?.user ?? null,
      slot: saved?.slot ?? Buffer.from(random(16)).toString('hex'),
      account: saved?.account ?? false,
      github: saved?.github ?? false,
      gistId: saved?.gistId ?? null,
      lastBackupAt: saved?.lastBackupAt ?? null,
      error: saved?.error ?? null,
      listedId: saved?.listedId ?? null,
    }
    if (!saved?.slot) this.host.setState(STATE_KEY, state)
    return state
  }

  private save(patch: Partial<State>) {
    this.host.setState(STATE_KEY, { ...this.state(), ...patch })
    this.host.changed()
  }

  async status(): Promise<AccountStatus> {
    const state = this.state()
    return {
      signedIn: !!state.user,
      user: state.user,
      backup: {
        account: state.account,
        github: state.github,
        lastBackupAt: state.lastBackupAt,
        error: state.error,
        hasKey: !!this.key.savedField(),
      },
      listed: !!state.listedId,
      pendingSignIn: this.signing?.started ?? null,
    }
  }

  // ---- Talking to the service ----

  private async call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const bearer = token ?? (await this.session.read())?.token
    const response = await this.fetcher(`${this.url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const parsed = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    if (response.status === 401 && bearer) {
      await this.session.remove()
      this.save({ user: null, listedId: null })
      throw new Error('The Ramu account signed this host out. Sign in again.')
    }
    if (!response.ok)
      throw new Error(parsed.error ?? parsed.message ?? `The account service answered ${response.status}.`)
    return parsed as T
  }

  // ---- Sign-in ----

  /** Starts the device code sign-in: show the code, open the page; the host waits for the person to approve it. */
  async signIn(client = 'ramu-host'): Promise<AccountSignIn> {
    const started = await this.call<{
      device_code: string
      user_code: string
      verification_uri_complete?: string
      verification_uri: string
      expires_in: number
      interval?: number
    }>('POST', '/api/auth/device/code', { client_id: client }, '')
    const signIn: AccountSignIn = {
      userCode: started.user_code,
      verificationUri:
        started.verification_uri_complete ?? `${started.verification_uri}?user_code=${started.user_code}`,
      expiresAt: Date.now() + started.expires_in * 1000,
    }
    this.signing = {
      started: signIn,
      deviceCode: started.device_code,
      interval: Math.max(5, started.interval ?? 5),
      client,
    }
    this.host.changed()
    void this.waitForSignIn()
    return signIn
  }

  private async waitForSignIn() {
    const pending = this.signing
    while (pending && this.signing === pending && Date.now() < pending.started.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, pending.interval * 1000))
      if (this.signing !== pending) return
      const response = await this.fetcher(`${this.url}/api/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: pending.deviceCode,
          client_id: pending.client,
        }),
      }).catch(() => null)
      const body = (await response?.json().catch(() => ({}))) as { access_token?: string; error?: string }
      if (body?.access_token) {
        await this.session.save({ token: body.access_token })
        const user = await this.call<AccountUser>('GET', '/api/me')
        this.signing = null
        this.save({ user })
        return
      }
      if (body?.error && !['authorization_pending', 'slow_down'].includes(body.error)) break
    }
    if (this.signing === pending) this.signing = null
    this.host.changed()
  }

  cancelSignIn() {
    this.signing = null
    this.host.changed()
  }

  /** Signs this host out: its session and its copy of the backup key go; other devices keep theirs. */
  async signOut() {
    await this.call('POST', '/api/auth/sign-out', {}).catch(() => {})
    await this.session.remove()
    await this.key.remove()
    this.stopPolling()
    this.save({ user: null, account: false, listedId: null })
  }

  async deleteAccount() {
    await this.call('DELETE', '/api/me')
    await this.session.remove()
    await this.key.remove()
    this.stopPolling()
    this.save({ user: null, account: false, listedId: null, lastBackupAt: null })
  }

  // ---- Backups ----

  private async backupKey(): Promise<Uint8Array | null> {
    const saved = await this.key.read()
    return saved ? fromBase64(saved.token) : null
  }

  /**
   * Turns a destination on or off. The first time either is turned on, the host makes the backup key and a recovery
   * code, which is returned once to be kept in a password manager.
   */
  async setBackup(destinations: { account?: boolean; github?: boolean }): Promise<{ recoveryCode: string | null }> {
    const state = this.state()
    if (destinations.account && !state.user) throw new Error('Sign in to the Ramu account first.')
    if (destinations.github && !(await this.host.githubToken()))
      throw new Error('Sign in to GitHub on this host first.')
    let recoveryCode: string | null = null
    let key = await this.backupKey()
    if (!key && (destinations.account || destinations.github)) {
      key = newBackupKey(random)
      await this.key.save({ token: toBase64(key) })
      recoveryCode = newRecoveryCode(random)
      await this.keepRecovery(key, recoveryCode, { account: !!destinations.account, github: !!destinations.github })
    }
    this.save({
      account: destinations.account ?? state.account,
      github: destinations.github ?? state.github,
      error: null,
    })
    await this.backupNow().catch(() => {})
    return { recoveryCode }
  }

  /** A new recovery code; the old one stops opening the backup key. */
  async newRecoveryCode(): Promise<string> {
    const key = await this.backupKey()
    if (!key) throw new Error('Turn on backups first.')
    const code = newRecoveryCode(random)
    const state = this.state()
    await this.keepRecovery(key, code, { account: state.account, github: state.github })
    return code
  }

  private async keepRecovery(key: Uint8Array, code: string, where: { account: boolean; github: boolean }) {
    const sealed = toBase64(seal(recoveryKey(code), key, random, 'recovery'))
    if (where.account && this.state().user) await this.call('PUT', '/api/recovery', { sealed })
    if (where.github) await this.gist({ [GIST_RECOVERY]: sealed })
  }

  /** Called when a setting changes: backs up after a short delay, at most once a minute. */
  settingsChanged() {
    const state = this.state()
    if (!state.account && !state.github) return
    if (this.backupTimer) clearTimeout(this.backupTimer)
    const wait = Math.max(5_000, (state.lastBackupAt ?? 0) + ACCOUNT_LIMITS.uploadEveryMs - Date.now())
    this.backupTimer = setTimeout(() => void this.backupNow().catch(() => {}), wait)
    this.backupTimer.unref?.()
  }

  async backupNow() {
    const state = this.state()
    const key = await this.backupKey()
    if (!key || (!state.account && !state.github)) return
    try {
      const file = await this.host.exportSettings()
      const plain = deflateRawSync(Buffer.from(JSON.stringify(file)))
      const sealed = seal(key, plain, random, state.slot, SEALED_DEFLATE)
      if (state.account && state.user) {
        const label = seal(key, new TextEncoder().encode(this.host.hostName()), random, `${state.slot}:label`)
        await this.call('PUT', `/api/backups/${state.slot}`, {
          kind: 'host',
          label: toBase64(label),
          ciphertext: toBase64(sealed),
        })
      }
      if (state.github) await this.gist({ [GIST_FILE]: `${state.slot}\n${toBase64(sealed)}` })
      this.save({ lastBackupAt: Date.now(), error: null })
    } catch (error) {
      this.save({ error: (error as Error).message.slice(0, 300) })
      throw error
    }
  }

  /** Writes files to this person's private settings gist, making it the first time. */
  private async gist(files: Record<string, string>) {
    const token = await this.host.githubToken()
    if (!token) throw new Error('Sign in to GitHub on this host first.')
    const state = this.state()
    const body = {
      description: 'Ramu settings backup (sealed; only your devices can open it)',
      public: false,
      files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { content }])),
    }
    const response = await this.fetcher(`https://api.github.com/gists${state.gistId ? `/${state.gistId}` : ''}`, {
      method: state.gistId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok)
      throw new Error(`GitHub refused the backup gist (${response.status}). Check the token has the gist scope.`)
    if (!state.gistId) this.save({ gistId: ((await response.json()) as { id: string }).id })
  }

  async deleteBackups(destination: 'account' | 'github') {
    const state = this.state()
    if (destination === 'account' && state.user) await this.call('DELETE', `/api/backups/${state.slot}`)
    if (destination === 'github' && state.gistId) {
      const token = await this.host.githubToken()
      if (token)
        await this.fetcher(`https://api.github.com/gists/${state.gistId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        })
      this.save({ gistId: null })
    }
  }

  // ---- Restore ----

  /** Backups this person's devices made, from the account and from a settings gist on their GitHub. */
  async restoreChoices(): Promise<RestoreChoice[]> {
    const key = await this.backupKey()
    if (!key) throw new Error('Get the backup key first: approve on another device, or use the recovery code.')
    const choices: RestoreChoice[] = []
    if (this.state().user)
      for (const slot of await this.call<BackupSlotInfo[]>('GET', '/api/backups')) {
        let name = slot.kind === 'phone' ? 'A phone' : 'A host'
        try {
          name = new TextDecoder().decode(open(key, fromBase64(slot.label), `${slot.slot}:label`).plaintext)
        } catch {
          // Sealed under another key: listed by kind only.
        }
        choices.push({ source: 'account', slot: slot.slot, name, kind: slot.kind, versions: slot.versions })
      }
    const gist = await this.findGist()
    if (gist?.settings) {
      const [slot] = gist.settings.split('\n')
      choices.push({
        source: 'github',
        slot: slot!,
        name: 'Your GitHub',
        kind: 'host',
        versions: [{ id: 'latest', createdAt: gist.updatedAt, size: gist.settings.length }],
      })
    }
    return choices
  }

  /** The settings in one backup, opened here, for the same review as Import settings. */
  async restoreFile(choice: { source: 'account' | 'github'; slot: string; version: string }): Promise<SettingsExport> {
    const key = await this.backupKey()
    if (!key) throw new Error('Get the backup key first.')
    let sealed: Uint8Array
    if (choice.source === 'account') {
      const { ciphertext } = await this.call<{ ciphertext: string }>(
        'GET',
        `/api/backups/${choice.slot}/${choice.version}`,
      )
      sealed = fromBase64(ciphertext)
    } else {
      const gist = await this.findGist()
      if (!gist?.settings) throw new Error('No settings backup is on your GitHub.')
      sealed = fromBase64(gist.settings.split('\n')[1] ?? '')
    }
    const opened = open(key, sealed, choice.slot)
    const plain = opened.flags & SEALED_DEFLATE ? inflateRawSync(opened.plaintext) : Buffer.from(opened.plaintext)
    return settingsExportSchema.parse(JSON.parse(plain.toString('utf8')))
  }

  private async findGist(): Promise<{
    id: string
    settings: string | null
    recovery: string | null
    updatedAt: number
  } | null> {
    const token = await this.host.githubToken()
    if (!token) return null
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    const list = await this.fetcher('https://api.github.com/gists?per_page=100', { headers }).then((response) =>
      response.ok
        ? (response.json() as Promise<{ id: string; updated_at: string; files: Record<string, unknown> }[]>)
        : [],
    )
    const found = list.find((gist) => GIST_FILE in gist.files || GIST_RECOVERY in gist.files)
    if (!found) return null
    const full = (await this.fetcher(`https://api.github.com/gists/${found.id}`, { headers }).then((response) =>
      response.json(),
    )) as {
      files: Record<string, { content?: string }>
    }
    if (!this.state().gistId) this.save({ gistId: found.id })
    return {
      id: found.id,
      settings: full.files[GIST_FILE]?.content ?? null,
      recovery: full.files[GIST_RECOVERY]?.content ?? null,
      updatedAt: Date.parse(found.updated_at),
    }
  }

  /** Opens the backup key with the recovery code, from the account or from the GitHub gist. */
  async useRecoveryCode(code: string, source: 'account' | 'github') {
    const sealed =
      source === 'account'
        ? (await this.call<{ sealed: string | null }>('GET', '/api/recovery')).sealed
        : (await this.findGist())?.recovery
    if (!sealed)
      throw new Error(
        source === 'account'
          ? 'This account has no recovery copy of a backup key.'
          : 'No recovery copy is on your GitHub.',
      )
    let key: Uint8Array
    try {
      key = open(recoveryKey(code), fromBase64(sealed), 'recovery').plaintext
    } catch (error) {
      throw new Error(
        error instanceof SealError
          ? 'That recovery code does not open this backup. Check it and try again.'
          : (error as Error).message,
        { cause: error },
      )
    }
    await this.key.save({ token: toBase64(key) })
    this.host.changed()
  }

  // ---- Approve on another device ----

  /** This host asks the person's other devices for the backup key. */
  async requestKey() {
    const keys = exchangeKeys(random)
    const { id } = await this.call<{ id: string }>('POST', '/api/key-requests', {
      name: this.host.hostName().slice(0, 60),
      commit: exchangeCommit(keys.publicKey),
    })
    this.asking = { id, keys, code: null, done: false, error: null }
    this.host.changed()
    void this.followRequest()
    return { id }
  }

  keyRequestState() {
    return this.asking ? { code: this.asking.code, done: this.asking.done, error: this.asking.error } : null
  }

  private async followRequest() {
    const asking = this.asking
    const until = Date.now() + ACCOUNT_LIMITS.requestMs
    while (asking && this.asking === asking && !asking.done && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      try {
        const request = await this.call<KeyRequestInfo>('GET', `/api/key-requests/${asking.id}`)
        if (request.approverKey && !request.requesterKey) {
          await this.call('POST', `/api/key-requests/${asking.id}/reveal`, { requesterKey: asking.keys.publicKey })
          asking.code = exchangeSecrets(asking.keys.secret, request.approverKey, {
            requestId: asking.id,
            commit: request.commit,
            requesterKey: asking.keys.publicKey,
            approverKey: request.approverKey,
          }).code
          this.host.changed()
        }
        if (request.envelope && request.approverKey) {
          const { key } = exchangeSecrets(asking.keys.secret, request.approverKey, {
            requestId: asking.id,
            commit: request.commit,
            requesterKey: asking.keys.publicKey,
            approverKey: request.approverKey,
          })
          const backup = open(key, fromBase64(request.envelope), `key:${asking.id}`).plaintext
          await this.key.save({ token: toBase64(backup) })
          asking.done = true
          this.host.changed()
        }
      } catch (error) {
        asking.error = (error as Error).message
        this.host.changed()
        return
      }
    }
  }

  /** Requests from the person's other devices this host can answer, with the number to compare once there is one. */
  async keyRequests(): Promise<{ id: string; name: string; code: string | null; expiresAt: number }[]> {
    if (!(await this.backupKey())) return []
    const requests = await this.call<KeyRequestInfo[]>('GET', '/api/key-requests')
    return requests.map((request) => {
      const keys = this.answering.get(request.id)
      const code =
        keys && request.requesterKey
          ? exchangeSecrets(keys.secret, request.requesterKey, {
              requestId: request.id,
              commit: request.commit,
              requesterKey: request.requesterKey,
              approverKey: keys.publicKey,
            }).code
          : null
      return { id: request.id, name: request.name, code, expiresAt: request.expiresAt }
    })
  }

  /** Begins answering a request; both screens then show the same number. */
  async answerKeyRequest(id: string) {
    const keys = exchangeKeys(random)
    await this.call('POST', `/api/key-requests/${id}/offer`, { approverKey: keys.publicKey })
    this.answering.set(id, keys)
  }

  /** Sends the backup key, sealed to the new device, once the person saw the numbers match. */
  async approveKeyRequest(id: string) {
    const keys = this.answering.get(id)
    const backup = await this.backupKey()
    if (!keys || !backup) throw new Error('Start answering this request first.')
    const request = (await this.call<KeyRequestInfo[]>('GET', '/api/key-requests')).find((entry) => entry.id === id)
    if (!request?.requesterKey) throw new Error('The new device has not shown its number yet.')
    const { key } = exchangeSecrets(keys.secret, request.requesterKey, {
      requestId: id,
      commit: request.commit,
      requesterKey: request.requesterKey,
      approverKey: keys.publicKey,
    })
    await this.call('POST', `/api/key-requests/${id}/approve`, {
      envelope: toBase64(seal(key, backup, random, `key:${id}`)),
    })
    this.answering.delete(id)
  }

  async denyKeyRequest(id: string) {
    await this.call('DELETE', `/api/key-requests/${id}`)
    this.answering.delete(id)
  }

  // ---- Your hosts ----

  /** List in my account: the account learns this host's name and id, and when it was last seen; never an address. */
  async setListed(listed: boolean) {
    const state = this.state()
    if (listed) {
      if (!state.user) throw new Error('Sign in to the Ramu account first.')
      const { id } = await this.call<{ id: string }>('PUT', '/api/hosts', {
        name: this.host.hostName().slice(0, 80),
        hostKey: this.host.hostId,
      })
      this.save({ listedId: id })
      this.startPolling()
    } else {
      if (state.listedId) await this.call('DELETE', `/api/hosts/${state.listedId}`).catch(() => {})
      this.stopPolling()
      this.save({ listedId: null })
    }
  }

  /** Checks for relayed pairing requests while it runs, and immediately while Pair a device is open. */
  start() {
    if (this.state().listedId && this.state().user) this.startPolling()
  }

  private startPolling() {
    this.stopPolling()
    this.pollTimer = setInterval(() => void this.checkRelay().catch(() => {}), ACCOUNT_LIMITS.hostPollMs)
    this.pollTimer.unref?.()
    void this.checkRelay().catch(() => {})
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async checkRelay() {
    const listed = this.state().listedId
    if (!listed) return
    const messages = await this.call<{ id: string; path: string; body: unknown; from: string }[]>(
      'GET',
      `/api/hosts/${listed}/messages`,
    )
    await Promise.all(
      messages.map(async (message) => {
        // A device's three messages come from one session, so the host sees one peer for the whole exchange.
        const reply = await this.host.pairing(`account:${message.from}`, message.path, message.body)
        await this.call('POST', `/api/hosts/${listed}/messages/${message.id}`, { reply })
      }),
    )
  }

  /** Hosts listed in this person's account, for **Add a host → Your hosts**. */
  async hosts(): Promise<ListedHostInfo[]> {
    if (!this.state().user) return []
    const listed = this.state().listedId
    return (await this.call<ListedHostInfo[]>('GET', '/api/hosts')).filter((host) => host.id !== listed)
  }

  /**
   * One pairing message from this device to a listed host, carried by the account: posted, then waited for until the
   * host answers (it checks every 30 seconds). Used as `requestPairing`'s `post`, so the exchange is the nearby one.
   */
  async relay(
    hostId: string,
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<{ status: number; body: unknown }> {
    const { id } = await this.call<{ id: string }>('POST', `/api/hosts/${hostId}/relay`, { path, body })
    const until = Date.now() + ACCOUNT_LIMITS.requestMs
    while (Date.now() < until && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const answer = await this.call<{ waiting: boolean; reply?: { status: number; body: unknown } }>(
        'GET',
        `/api/relay/${id}`,
      )
      if (!answer.waiting && answer.reply) return answer.reply
    }
    return { status: 408, body: { error: 'The host did not answer in time. Check that it is running.' } }
  }

  close() {
    this.stopPolling()
    if (this.backupTimer) clearTimeout(this.backupTimer)
  }
}
