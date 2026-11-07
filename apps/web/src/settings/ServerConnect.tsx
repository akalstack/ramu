import { useCallback, useEffect, useId, useState } from 'react'
import { DOCKER_INSTALL_PAGE, DOCKER_INSTALL_STEPS } from '@ramu/shared/serverDeploy'
import type { ServerStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { t, useLanguage } from '../i18n'
import { copyText, invoke as openOnThisComputer, type ramu } from '../ipc'
import { errorText } from '../lib/errors'

type Invoke = typeof ramu.invoke

/**
 * The person's own server: its address, the user Ramu signs in as and an SSH key (one Ramu creates, whose public line
 * the person adds to the server, or one they paste), then whether Docker can run apps there. Used in Settings →
 * Hosting accounts and in the Deploy sheet. Connecting happens only on the host.
 */
export function ServerConnect({
  invoke,
  canAdminister,
  onConnected,
}: {
  invoke: Invoke
  canAdminister: boolean
  /** Called once the server is connected and checked. */
  onConnected?: (status: ServerStatus) => void
}) {
  useLanguage()
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [user, setUser] = useState('')
  const [own, setOwn] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { host: useId(), port: useId(), user: useId(), key: useId() }
  const load = useCallback(
    (check: boolean) =>
      void Promise.resolve(invoke('deploy.server', check)).then(setStatus, (reason) => setError(errorText(reason))),
    [invoke],
  )
  useEffect(() => load(true), [load])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const portNumber = Number(port)
  const connection = status?.connection ?? null
  const keyLine = connection?.publicKey ?? status?.pendingKey ?? null

  if (!status) return <p className="m-0 text-caption text-muted-foreground">{error ?? t('Checking…')}</p>
  return (
    <div className="flex flex-col gap-2 text-caption">
      {connection ? (
        <>
          <p className="m-0">
            {t('Signed in as {0} on {1}.', {
              0: connection.user,
              1: connection.port === 22 ? connection.host : `${connection.host}:${connection.port}`,
            })}{' '}
            <span className="text-muted-foreground">
              {t('Server key {0}, pinned on first connect; a different key is refused.', {
                0: connection.fingerprint,
              })}
            </span>
          </p>
          <DockerState status={status} onCheck={() => load(true)} />
        </>
      ) : !canAdminister ? (
        <p className="m-0 text-muted-foreground">{t('Connect your server on the machine running this host.')}</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const next = await invoke('deploy.connectServer', {
                host: host.trim(),
                port: portNumber,
                user: user.trim(),
                privateKey: own ? privateKey : null,
              })
              setPrivateKey('')
              setStatus(next)
              onConnected?.(next)
            })
          }}
        >
          <span className="flex flex-wrap gap-2">
            <label htmlFor={ids.host} className="flex min-w-48 flex-1 flex-col gap-1">
              {t('Address')}
              <Input
                id={ids.host}
                placeholder="203.0.113.10"
                autoCapitalize="none"
                spellCheck={false}
                value={host}
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
            <label htmlFor={ids.port} className="flex w-20 flex-col gap-1">
              {t('Port')}
              <Input
                id={ids.port}
                inputMode="numeric"
                value={port}
                onChange={(event) => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))}
              />
            </label>
            <label htmlFor={ids.user} className="flex w-36 flex-col gap-1">
              {t('User')}
              <Input
                id={ids.user}
                placeholder="deploy"
                autoCapitalize="none"
                spellCheck={false}
                value={user}
                onChange={(event) => setUser(event.target.value)}
              />
            </label>
          </span>
          {own ? (
            <label htmlFor={ids.key} className="flex flex-col gap-1">
              {t('Private key')}
              <Textarea
                id={ids.key}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-caption"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
              />
              <span className="text-muted-foreground">
                {t(
                  'It goes straight to this host’s credential store and is never shown again. A key with a passphrase cannot be used.',
                )}
              </span>
            </label>
          ) : keyLine ? (
            <div className="flex flex-col gap-1">
              <span>
                {t('On the server, add this line to ~/.ssh/authorized_keys for that user, then press Connect.')}
              </span>
              <code className="block rounded-(--radius-s) bg-fill p-2 font-mono break-all">{keyLine}</code>
              <span>
                <Button type="button" size="sm" variant="ghost" onClick={() => void copyText(keyLine)}>
                  {t('Copy')}
                </Button>
              </span>
            </div>
          ) : (
            <span>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const pendingKey = await invoke('deploy.serverKey')
                    setStatus((current) => (current ? { ...current, pendingKey } : current))
                  })
                }
              >
                {t('Create a key for this server')}
              </Button>
            </span>
          )}
          <span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOwn((value) => !value)}>
              {own ? t('Use a key Ramu creates instead') : t('Use a key I already have')}
            </Button>
          </span>
          <p className="m-0 text-muted-foreground">
            {t('Ramu remembers the server’s own key on this first connection and refuses a different one later.')}
          </p>
          {error && (
            <p role="alert" className="m-0 text-destructive">
              {error}
            </p>
          )}
          <span>
            <Button
              type="submit"
              size="sm"
              disabled={
                busy ||
                !host.trim() ||
                !user.trim() ||
                !(portNumber >= 1 && portNumber <= 65535) ||
                (own ? !privateKey.trim() : !keyLine)
              }
            >
              {busy ? t('Connecting…') : t('Connect')}
            </Button>
          </span>
        </form>
      )}
      {connection && error && (
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Whether Docker can run the app, with Docker's own install steps for the person to run when it cannot. */
function DockerState({ status, onCheck }: { status: ServerStatus; onCheck: () => void }) {
  if (status.error)
    return (
      <p role="alert" className="m-0 text-destructive">
        {status.error}
      </p>
    )
  if (!status.docker) return null
  if (status.docker === 'ready')
    return (
      <p className="m-0">
        {t('Docker {0} is ready.', { 0: status.dockerVersion ?? '' })}
        {status.portsBusy && (
          <span className="text-destructive">
            {' '}
            {t('Another web server already uses port 80 or 443; stop it so Caddy can serve HTTPS.')}
          </span>
        )}
      </p>
    )
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0">
        {status.docker === 'no-permission'
          ? t(
              'Docker is installed, but this user cannot use it. Add the user to the docker group, sign in to the server again, and check that Docker is running.',
            )
          : t(
              'Docker is not installed. Ramu never installs software on your server; run Docker’s own steps there yourself:',
            )}
      </p>
      {status.docker === 'missing' && (
        <pre className="m-0 rounded-(--radius-s) bg-fill p-2 font-mono whitespace-pre-wrap">
          {DOCKER_INSTALL_STEPS.join('\n')}
        </pre>
      )}
      <span className="flex flex-wrap gap-1">
        {status.docker === 'missing' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void openOnThisComputer('app.openExternal', DOCKER_INSTALL_PAGE)}
          >
            {t('Open Docker’s install guide')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onCheck}>
          {t('Check again')}
        </Button>
      </span>
    </div>
  )
}
