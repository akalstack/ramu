import { useEffect, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import type { Computer, Computers as ComputerList, DeviceOs } from '@ramu/shared/types'
import { osLine } from '@ramu/shared/deviceOs'
import { Button } from '@/components/desktop-button'
import { DeviceIcon } from '@/components/device-icon'
import { Dialog as ConfirmDialog, Menu } from '../../Menu'
import { invoke, invokeOn, invokeUncachedOn } from '../../ipc'
import { errorText } from '../../lib/errors'
import { notifyError } from '../../chat/Notifications'
import { t, useLanguage } from '../../i18n'
import { activityText, hostRoute, StatusDot, statusText } from '../../workspace/computers'
import { onPairLink, takePairLink } from '../../pairLink'
import { AccountHostsList } from '../AccountAccess'
import { SettingsEmpty } from '../cards'
import { HostAccess } from '../DevicePermissions'
import { HostUpdateLine, UpdateAllHosts } from '../HostUpdates'
import { RenameDialog } from '../RenameDialog'
import { AccessSection } from './AccessSection'
import { AddHostDialog } from './AddHostDialog'
import { HostConnectionDialog } from './HostConnectionDialog'
import { InviteBackDialog } from './InviteBackDialog'

/** What each connected host runs on, read from its own status; a host not reachable keeps the last answer. */
function useHostOs(computers: Computer[]): Record<string, DeviceOs | undefined> {
  const [known, setKnown] = useState<Record<string, DeviceOs | undefined>>({})
  const reachable = computers.filter((computer) => computer.local || computer.status === 'connected')
  const key = reachable.map((computer) => computer.id).join(',')
  useEffect(() => {
    for (const computer of reachable)
      void invokeUncachedOn(computer.id, 'background.status').then(
        (status) => status.os && setKnown((current) => ({ ...current, [computer.id]: status.os })),
        () => {},
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the reachable hosts
  }, [key])
  return known
}

/**
 * The hosts this computer works on, with their status, updates and what this device lacks there, and the hosts on the
 * Ramu account it does not use yet. Adding, renaming, pausing and forgetting a host happen here.
 */
export function HostsYouUse({ state }: { state: ComputerList }) {
  const hostOs = useHostOs(state.computers)
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState<{ link?: string; repair?: Computer } | null>(null),
    [editing, setEditing] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState<string | null>(null)
  const [inviting, setInviting] = useState<Computer | null>(null)
  const [renaming, setRenaming] = useState<{ computer: Computer; name: string; original: string | null } | null>(null)
  // This computer is renamed on its own service, for every device and host that sees it; another host is renamed
  // here only, with its own chosen name one click away.
  const rename = async (computer: Computer) => {
    if (computer.local) {
      const info = await invoke('host.name').catch(() => null)
      setRenaming({ computer, name: info?.name ?? computer.name, original: info?.systemName ?? null })
      return
    }
    const own = computer.status === 'connected' ? await invokeOn(computer.id, 'host.name').catch(() => null) : null
    setRenaming({ computer, name: computer.name, original: own?.name ?? null })
  }
  const others = state.computers.filter((computer) => !computer.local)
  const selected = state.computers.find((computer) => computer.id === editing)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (error) {
      notifyError(errorText(error), t('Hosts'))
    } finally {
      setBusy(false)
    }
  }
  // A pairing link opened from outside the app arrives while this screen is showing, or just before it does.
  useEffect(() => {
    const show = () => {
      const incoming = takePairLink()
      if (incoming) setAdding({ link: incoming })
    }
    show()
    return onPairLink(show)
  }, [])
  const connected = state.computers.filter((computer) => computer.status === 'connected').length
  return (
    <AccessSection
      title={t('Hosts you use')}
      help={
        others.length
          ? t('{0} connected · {1} saved', { 0: connected, 1: state.computers.length })
          : t('They stay connected together while Ramu is open.')
      }
      actions={
        <>
          <UpdateAllHosts computers={state.computers} />
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAdding({})}>
            <Plus size={14} />
            {t('Add a host')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {state.computers.map((computer) => (
          <article
            key={computer.id}
            className={`computer-card rounded-(--radius-m) px-3 py-2.5 ${computer.id === state.current ? 'bg-primary/10' : 'bg-fill'}`}
            aria-label={computer.name}
          >
            <div className="flex items-center gap-3">
              <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-s) bg-hover text-muted-foreground">
                <DeviceIcon os={hostOs[computer.id]} name={computer.name} />
              </span>
              <div className="min-w-0 grow">
                <div className="flex min-w-0 items-center gap-2">
                  <strong className="truncate text-body font-medium">{computer.name}</strong>
                  {!computer.local && (
                    <span className="flex-none text-caption text-muted-foreground">
                      {computer.ssh ? t('SSH') : t('Remote')}
                    </span>
                  )}
                  {computer.id === state.current && (
                    <span className="flex-none rounded-full bg-primary/10 px-2 py-0.5 text-caption text-(--accent)">
                      {t('Showing')}
                    </span>
                  )}
                </div>
                <p
                  className="m-0 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
                  title={computer.ssh ? `ssh ${computer.ssh}` : (computer.url ?? state.deviceName)}
                >
                  <StatusDot status={computer.status} />
                  <span className="truncate">
                    {[
                      activityText(computer) || statusText(computer.status),
                      hostRoute(computer),
                      osLine(hostOs[computer.id]),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </p>
              </div>
              <div className="flex flex-none items-center gap-1">
                {computer.id !== state.current && (computer.local || computer.status === 'connected') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.open', computer.id))}
                  >
                    {t('Open')}
                  </Button>
                )}
                {!computer.local && computer.status === 'offline' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.retry', computer.id))}
                  >
                    {t('Retry')}
                  </Button>
                )}
                {!computer.local && computer.status === 'paused' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => invoke('computers.update', computer.id, { enabled: true }))}
                  >
                    {t('Resume')}
                  </Button>
                )}
                {!computer.local && computer.status === 'rejected' && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAdding({ repair: computer })}>
                    {t('Pair again')}
                  </Button>
                )}
                {computer.local && (
                  <Menu
                    label={t('More for {0}', { 0: computer.name })}
                    icon={<MoreHorizontal size={15} />}
                    align="end"
                    disabled={busy}
                    items={[{ key: 'rename', label: t('Rename this host…'), onSelect: () => void rename(computer) }]}
                  />
                )}
                {!computer.local && (
                  <Menu
                    label={t('More for {0}', { 0: computer.name })}
                    icon={<MoreHorizontal size={15} />}
                    align="end"
                    disabled={busy}
                    items={[
                      { key: 'rename', label: t('Rename…'), onSelect: () => void rename(computer) },
                      { key: 'settings', label: t('Connection settings…'), onSelect: () => setEditing(computer.id) },
                      ...(computer.status === 'connected'
                        ? [
                            {
                              key: 'invite',
                              label: t('Let {0} connect here…', { 0: computer.name }),
                              onSelect: () => setInviting(computer),
                            },
                          ]
                        : []),
                      ...(computer.status === 'paused' || computer.status === 'rejected'
                        ? []
                        : [
                            {
                              key: 'pause',
                              label: t('Pause connection'),
                              onSelect: () =>
                                void act(() => invoke('computers.update', computer.id, { enabled: false })),
                            },
                          ]),
                      { key: 'gap', separator: true as const },
                      { key: 'forget', label: t('Forget…'), danger: true, onSelect: () => setForgetting(computer.id) },
                    ]}
                  />
                )}
              </div>
            </div>
            {/* Under the name: Ramu's version and updates, then what this device may do there, set apart by a rule. */}
            <div className="ml-[44px] flex flex-col gap-1 empty:hidden">
              <HostUpdateLine computer={computer} />
              {computer.grantedUnreachable && (
                <p role="status" className="m-[6px_0_0] text-caption text-muted-foreground">
                  {t(
                    'Paired, but this host has not answered yet. Ramu keeps the access and connects when the host is reachable. You do not need the code again.',
                  )}
                </p>
              )}
              {!computer.local && computer.status === 'connected' && (
                <div className="mt-1.5 flex flex-col gap-1 border-t border-border pt-1.5 empty:hidden">
                  <HostAccess computer={computer} />
                </div>
              )}
            </div>
          </article>
        ))}
        {!others.length && (
          <SettingsEmpty>
            {t('No other hosts yet. Add a laptop, workstation or server to work on it from here.')}
          </SettingsEmpty>
        )}
      </div>
      <AccountHostsList computers={state.computers} />
      {adding && <AddHostDialog {...adding} onClose={() => setAdding(null)} />}
      {inviting && (
        <InviteBackDialog
          computer={inviting}
          from={state.computers.find((computer) => computer.local)?.name ?? state.deviceName}
          onClose={() => setInviting(null)}
        />
      )}
      {selected && <HostConnectionDialog key={selected.id} computer={selected} onClose={() => setEditing(null)} />}
      {renaming && (
        <RenameDialog
          title={renaming.computer.local ? t('Rename this host') : t('Rename {0}', { 0: renaming.computer.name })}
          help={
            renaming.computer.local
              ? t(
                  'Phones and computers that pair with it, find it nearby or see it on your Ramu account show this name.',
                )
              : t('Saved on this device. The host keeps its own name.')
          }
          name={renaming.name}
          original={renaming.original}
          onSave={(name) =>
            renaming.computer.local
              ? invoke('network.renameHost', name)
              : invoke('computers.update', renaming.computer.id, {
                  name: name ?? renaming.original ?? renaming.computer.name,
                })
          }
          onClose={() => setRenaming(null)}
        />
      )}
      {forgetting !== null && (
        <ConfirmDialog
          danger
          title={t('Forget {0}?', { 0: others.find((computer) => computer.id === forgetting)?.name ?? '' })}
          confirmLabel={t('Forget')}
          onCancel={() => setForgetting(null)}
          onConfirm={() => {
            const id = forgetting
            setForgetting(null)
            if (id) void act(() => invoke('computers.forget', id))
          }}
        >
          <p>
            {forgetting === state.current
              ? t('You are looking at it now, so Ramu goes back to this host. You can pair again later.')
              : t('You can pair again later. The other host still lists this device until you revoke it there.')}
          </p>
        </ConfirmDialog>
      )}
    </AccessSection>
  )
}
