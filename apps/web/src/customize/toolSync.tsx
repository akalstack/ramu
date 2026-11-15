import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  availableOn,
  type PortableTool,
  type ToolAvailability,
  type ToolKind,
  type ToolState,
  type ToolSyncStatus,
  type WaitingTool,
} from '@ramu/shared/toolSync'
import { refusedPermission } from '@ramu/shared/devicePermissions'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { notices } from '../chat/notificationCenter'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'
import { useHost } from '../workspace/HostProvider'
import { onHostEvent, useHostRuntime } from '../workspace/workspace'
import { openCustomize } from './openCustomize'
import { ExtensionGrid, ExtensionItem, SectionTitle } from './parts'

export { mcpLogins } from '@ramu/shared/toolSync'

/** The tools this host can send, what other hosts sent here, and which hosts each tool is kept on. */
export function useToolSync() {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [status, setStatus] = useState<ToolSyncStatus | null>(null)
  const load = useCallback(() => {
    void invoke('toolSync.status').then(setStatus, () => {})
  }, [invoke])
  useEffect(() => {
    load()
    const stops = (['toolSync:changed', 'plugins:changed', 'mcp:changed', 'memory:changed'] as const).map((channel) =>
      on(channel, load),
    )
    return () => stops.forEach((stop) => stop())
  }, [load, on])
  return { status, reload: load }
}

const stateText = (entry: WaitingTool) => {
  if (entry.state === 'remove') return t('Removed on {0}', { 0: entry.from })
  if (entry.state === 'update') return t('From {0} · another version than here', { 0: entry.from })
  if (entry.state === 'connect-here' && entry.tool.kind === 'mcp' && entry.tool.transport.type === 'stdio')
    return t('From {0} · needs {1} on this host', { 0: entry.from, 1: entry.tool.transport.command })
  return t('From {0}', { 0: entry.from })
}

/**
 * Tools another host sent, at the top of their Customize section: each opens the same review an install from here
 * does, and nothing is installed until it is approved. One the other host removed asks to be removed here too.
 */
export function WaitingTools({
  kind,
  status,
  busy,
  onReview,
  onRemove,
}: {
  kind: ToolKind
  status: ToolSyncStatus | null
  busy: string | null
  onReview: (entry: WaitingTool) => void
  /** Removes this host's copy of a tool its other host removed. */
  onRemove: (entry: WaitingTool) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const waiting = (status?.waiting ?? []).filter((entry) => entry.tool.kind === kind)
  if (!waiting.length) return null
  return (
    <>
      <SectionTitle
        title={t('From your other hosts')}
        count={waiting.length}
        help={t('Review each one to install it here. Keys and sign-ins are added on this host.')}
      />
      <ExtensionGrid label={t('From your other hosts')}>
        {waiting.map((entry) => (
          <ExtensionItem
            key={entry.key}
            name={entry.tool.name}
            subtitle={stateText(entry)}
            onOpen={entry.state === 'remove' ? undefined : () => onReview(entry)}
            action={
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => (entry.state === 'remove' ? onRemove(entry) : onReview(entry))}
                >
                  {busy === entry.key ? <RefreshCw size={13} className="animate-spin" /> : null}
                  {entry.state === 'remove'
                    ? t('Remove here')
                    : entry.state === 'update'
                      ? t('Review update')
                      : t('Review')}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={
                    entry.state === 'remove'
                      ? t('Keep {name} here', { name: entry.tool.name })
                      : t('Dismiss {name}', { name: entry.tool.name })
                  }
                  title={entry.state === 'remove' ? t('Keep it here') : t('Dismiss')}
                  disabled={busy !== null}
                  onClick={() => void invoke('toolSync.dismiss', entry.key)}
                >
                  <X size={14} />
                </Button>
              </>
            }
          />
        ))}
      </ExtensionGrid>
    </>
  )
}

interface OtherHost {
  /** The id this device gives the host, to call it. */
  id: string
  name: string
  /** The host's own id in tool choices. */
  syncId: string
  state: ToolState | 'waiting'
}

const other = (computers: ReturnType<typeof useComputers>, own: string) =>
  (computers?.computers ?? []).filter((computer) => computer.id !== own && computer.status === 'connected')

/** How one host has a tool: installed, waiting for a review there, or not there. */
async function hostState(id: string, tool: PortableTool, key: string) {
  const [status, compared] = await Promise.all([
    invokeOn(id, 'toolSync.status'),
    invokeOn(id, 'toolSync.compare', [tool]),
  ])
  const state: OtherHost['state'] = status.waiting.some((entry) => entry.key === key)
    ? 'waiting'
    : (compared[0]?.state ?? 'new')
  return { syncId: status.hostId, state }
}

const hostStateText = (state: OtherHost['state']) =>
  state === 'same'
    ? t('Installed')
    : state === 'waiting'
      ? t('Waiting for review there')
      : state === 'update'
        ? t('Another version there')
        : t('Not there')

/**
 * Available on: the hosts a tool is kept on besides this one. Choosing a host sends it the tool's setup to review
 * there; **All hosts** also reaches hosts connected later. Keys and sign-ins are added on each host.
 */
export function AvailableOn({ toolKey, status }: { toolKey: string; status: ToolSyncStatus | null }) {
  useLanguage()
  const host = useHost()
  const computers = useComputers()
  const [hosts, setHosts] = useState<OtherHost[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const tool = status?.portable[toolKey]
  const availability = status?.availability[toolKey]
  const connected = other(computers, host.id)
  const connectedKey = connected.map((computer) => computer.id).join(',')
  useEffect(() => {
    if (!tool) return
    let current = true
    void Promise.all(
      other(computers, host.id).map(async (computer) => {
        try {
          return { id: computer.id, name: computer.name, ...(await hostState(computer.id, tool, toolKey)) }
        } catch {
          return null
        }
      }),
    ).then((found) => current && setHosts(found.filter((entry): entry is OtherHost => !!entry)))
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hosts' answers change with which hosts are connected
  }, [toolKey, tool, connectedKey, host.id])
  if (!status) return null
  if (!tool) {
    const skipped = status.skipped.find((entry) => `${entry.kind}:${entry.name}` === toolKey)
    return skipped ? (
      <p className="m-0 text-caption text-muted-foreground">
        {skipped.reason === 'folder'
          ? t('Stays on this host: it runs from a folder here. Publish it to Git to use it on other hosts.')
          : t('Stays on this host: it belongs to one project here.')}
      </p>
    ) : null
  }
  const all = !!availability && 'all' in availability
  const chosen = (syncId: string) => availableOn(availability, syncId)
  const save = async (next: ToolAvailability | null, sendTo: OtherHost[]) => {
    setBusy(true)
    setMessage(null)
    try {
      await host.invoke('toolSync.setAvailability', toolKey, next)
      const needing = sendTo.filter((entry) => entry.state !== 'same' && entry.state !== 'waiting')
      const sent: string[] = []
      for (const entry of needing) {
        await invokeOn(entry.id, 'toolSync.receive', [tool], status.hostName)
        sent.push(entry.name)
      }
      if (sent.length) {
        setHosts((current) =>
          (current ?? []).map((entry) => (sent.includes(entry.name) ? { ...entry, state: 'waiting' as const } : entry)),
        )
        setMessage({ text: t('Sent to {0} for review there.', { 0: sent.join(', ') }) })
      }
    } catch (cause) {
      setMessage({ text: errorText(cause), error: true })
    } finally {
      setBusy(false)
    }
  }
  const toggleAll = (on: boolean) => void save(on ? { all: true } : null, on ? (hosts ?? []) : [])
  const toggle = (entry: OtherHost, on: boolean) => {
    const current = all
      ? (hosts ?? []).map((other) => other.syncId)
      : availability && 'hosts' in availability
        ? availability.hosts
        : []
    const next = on ? [...new Set([...current, entry.syncId])] : current.filter((id) => id !== entry.syncId)
    void save(next.length ? { hosts: next } : null, on ? [entry] : [])
  }
  return (
    <section className="flex flex-col gap-1.5 rounded-(--radius-s) bg-fill px-3 py-2" aria-label={t('Available on')}>
      <span className="text-control text-foreground">{t('Available on')}</span>
      <label className="flex items-center gap-2 text-control">
        <Checkbox checked={all} disabled={busy} onCheckedChange={(value) => toggleAll(value === true)} />
        {t('All your hosts')}
        <span className="text-caption text-muted-foreground">{t('including ones you connect later')}</span>
      </label>
      {hosts === null && connected.length > 0 ? (
        <span className="text-caption text-muted-foreground">{t('Checking your other hosts…')}</span>
      ) : hosts?.length ? (
        hosts.map((entry) => (
          <label key={entry.id} className="flex items-center gap-2 text-control">
            <Checkbox
              checked={all || chosen(entry.syncId)}
              disabled={busy || all}
              onCheckedChange={(value) => toggle(entry, value === true)}
            />
            <span className="min-w-0 truncate">{entry.name}</span>
            <span className="text-caption text-muted-foreground">{hostStateText(entry.state)}</span>
          </label>
        ))
      ) : (
        <span className="text-caption text-muted-foreground">
          {t('Connect another host to choose it here. All your hosts reaches it once it connects.')}
        </span>
      )}
      {message && (
        <span
          role={message.error ? 'alert' : 'status'}
          className={message.error ? 'text-caption text-bad' : 'text-caption text-muted-foreground'}
        >
          {message.text}
        </span>
      )}
    </section>
  )
}

/**
 * Removing a tool here, and asking this host's other hosts to remove it too: each of them confirms on its own Customize
 * page, and a host that connects later is asked then. Checked when the tool is kept on other hosts.
 */
export function useRemoveElsewhere(toolKey: string, status: ToolSyncStatus | null) {
  const host = useHost()
  const computers = useComputers()
  const kept = !!status?.availability[toolKey]
  const offered = !!status?.portable[toolKey] && (kept || other(computers, host.id).length > 0)
  const [on, setOn] = useState(kept)
  return {
    offered,
    on,
    setOn,
    /** Runs before the removal itself, while this host can still describe the tool. */
    before: async () => {
      // Asking the other hosts never stands in the way of removing it here.
      if (offered && on) await host.invoke('toolSync.removeEverywhere', toolKey).catch(() => {})
    },
  }
}

export function RemoveElsewhere({ control }: { control: ReturnType<typeof useRemoveElsewhere> }) {
  useLanguage()
  if (!control.offered) return null
  return (
    <label className="flex items-center gap-2 text-control">
      <Checkbox checked={control.on} onCheckedChange={(value) => control.setOn(value === true)} />
      {t('Also ask your other hosts to remove it')}
    </label>
  )
}

const SECTION: Record<ToolKind, 'plugins' | 'skills' | 'mcp'> = { plugin: 'plugins', skill: 'skills', mcp: 'mcp' }

/**
 * Sends each connected host the tools other connected hosts keep on it, when a host connects or a tool's hosts change.
 * A tool already there, or waiting there, is not sent again; one dismissed there stays dismissed until it changes.
 */
export function ToolSyncDelivery() {
  useLanguage()
  const computers = useComputers()
  const running = useRef(false)
  const again = useRef(false)
  const warned = useRef(new Set<string>())
  const [tick, setTick] = useState(0)
  const connected = (computers?.computers ?? []).filter((computer) => computer.status === 'connected')
  const connectedKey = connected.map((computer) => computer.id).join(',')
  useEffect(() => {
    const stops = connected.flatMap((computer) =>
      (['toolSync:changed', 'plugins:changed', 'mcp:changed', 'memory:changed'] as const).map((channel) =>
        onHostEvent(computer.id, channel, () => setTick((value) => value + 1)),
      ),
    )
    return () => stops.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows which hosts are connected
  }, [connectedKey])
  useEffect(() => {
    if (connected.length < 2) return
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    const own = computers?.current
    const run = async () => {
      const statuses = (
        await Promise.all(
          connected.map((computer) =>
            invokeOn(computer.id, 'toolSync.status').then(
              (status) => ({ computer, status }),
              () => null,
            ),
          ),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => !!entry)
      for (const target of statuses)
        for (const source of statuses) {
          if (source === target) continue
          const removals = Object.entries(source.status.removed)
            .filter(([key]) => !target.status.waiting.some((entry) => entry.key === key && entry.remove))
            .map(([, tool]) => tool)
          if (removals.length) {
            const states = await invokeOn(target.computer.id, 'toolSync.compare', removals).catch(() => [])
            const present = removals.filter(
              (_tool, index) =>
                states[index] && states[index].state !== 'new' && states[index].state !== 'connect-here',
            )
            if (present.length)
              await invokeOn(target.computer.id, 'toolSync.receive', present, source.status.hostName, true).catch(
                () => {},
              )
          }
          const wanted = Object.entries(source.status.portable)
            .filter(
              ([key]) =>
                availableOn(source.status.availability[key], target.status.hostId) &&
                !target.status.waiting.some((entry) => entry.key === key),
            )
            .map(([, tool]) => tool)
          if (!wanted.length) continue
          const compared = await invokeOn(target.computer.id, 'toolSync.compare', wanted).catch(() => [])
          const missing = wanted.filter((_tool, index) => compared[index] && compared[index].state !== 'same')
          if (!missing.length) continue
          const { waiting } = await invokeOn(
            target.computer.id,
            'toolSync.receive',
            missing,
            source.status.hostName,
          ).catch((cause: unknown) => {
            // Background sending has no screen of its own: say once why a host gets nothing, and what to change.
            if (!warned.current.has(target.computer.id)) {
              warned.current.add(target.computer.id)
              notices.add({
                id: `tool-sync-refused:${target.computer.id}`,
                type: 'error',
                title: t('Could not send tools to {0}', { 0: target.computer.name }),
                description:
                  refusedPermission(errorText(cause)) === 'settings'
                    ? t('Allow Change settings for this device on {0}, then it gets them.', {
                        0: target.computer.name,
                      })
                    : errorText(cause),
              })
            }
            return { waiting: 0 }
          })
          if (waiting && target.computer.id === own) {
            const first = missing[0]!
            notices.add({
              id: `tool-sync:${source.status.hostId}`,
              type: 'info',
              title:
                waiting === 1
                  ? t('{0} from {1} is ready to review', { 0: first.name, 1: source.status.hostName })
                  : t('{0} tools from {1} are ready to review', { 0: waiting, 1: source.status.hostName }),
              actionLabel: t('Review'),
              onAction: () => openCustomize(SECTION[first.kind]),
            })
          }
        }
    }
    void run()
      .catch(() => {})
      .finally(() => {
        running.current = false
        if (again.current) {
          again.current = false
          setTick((value) => value + 1)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when hosts connect or a host's tools change
  }, [connectedKey, tick])
  return null
}
