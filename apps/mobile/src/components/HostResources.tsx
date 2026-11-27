import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  cpuPercent,
  idleAgents,
  isBusy,
  isLowMemory,
  isWorkspaceContext,
  leftoverLabel,
  memoryBreakdown,
  memorySize,
  stopItemCall,
  threadActivity,
  type ResourceItem,
  type ResourceSnapshot,
  type ThreadResources,
} from '@ramu/shared/resources'
import type { ThreadServer } from '@ramu/shared/servers'
import { stopIdleThreads } from '@ramu/shared/chat/threadActions'
import { showError } from '../runtime/toast'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'
import { Group, Section } from './InboxParts'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const POLL_MS = 5000

/**
 * Figures for each online owner host, read only while the Resources sheet is open. The host being browsed comes first;
 * the others stay, since what a machine holds matters whichever host's threads are on screen.
 */
function useSnapshots(host: string | null) {
  const store = useStore()
  const ids = store.computers
    .filter((pc) => pc.status === 'online' && pc.access !== 'viewer')
    .map((pc) => pc.id)
    .sort((a, b) => Number(b === host) - Number(a === host))
  const key = ids.join(',')
  const [snapshots, setSnapshots] = useState<Record<string, ResourceSnapshot>>({})
  const [servers, setServers] = useState<Record<string, ThreadServer[]>>({})
  useEffect(() => {
    const read = () => {
      for (const id of key ? key.split(',') : [])
        void store
          .invoke(id, 'resources.snapshot')
          .then((snapshot) => setSnapshots((current) => ({ ...current, [id]: snapshot })))
          .catch(() => setSnapshots(({ [id]: _gone, ...rest }) => rest))
      for (const id of key ? key.split(',') : [])
        void store
          .invoke(id, 'servers.list')
          .then((list) => setServers((current) => ({ ...current, [id]: list })))
          .catch(() => setServers(({ [id]: _gone, ...rest }) => rest))
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => clearInterval(timer)
  }, [key, store.invoke]) // eslint-disable-line react-hooks/exhaustive-deps -- `invoke` is the only part of the store read here
  return ids.flatMap((id) => (snapshots[id] ? [{ id, data: snapshots[id], servers: servers[id] ?? [] }] : []))
}

const share = (part: number, whole: number) => `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%` as const

interface Part {
  key: string
  label: string
  value: number
  text: string
  color: string
}

/** One thin bar of coloured parts on a quiet track, a hairline between parts, as on the desktop. */
function Bar({ parts, total, height = 8 }: { parts: Part[]; total: number; height?: number }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 2,
        height,
        borderRadius: height,
        overflow: 'hidden',
        backgroundColor: c.fill,
      }}
    >
      {parts
        .filter((part) => part.key !== 'free' && part.value > 0)
        .map((part) => (
          <View key={part.key} style={{ width: share(part.value, total), minWidth: 3, backgroundColor: part.color }} />
        ))}
    </View>
  )
}

/** A reading of the host: what it is, the headline figure, the bar and each part named with its unit. */
function Meter({
  title,
  headline,
  detail,
  warning,
  total,
  parts,
}: {
  title: string
  headline: string
  detail: string
  warning?: string
  total: number
  parts: Part[]
}) {
  const { c } = useTheme()
  return (
    <View style={{ gap: space.xs + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
        <T size={font.caption} weight="500" tone="muted">
          {title}
        </T>
        {warning ? (
          <T size={font.caption} weight="500" tone="warn">
            {warning}
          </T>
        ) : null}
        <View style={{ flex: 1 }} />
        <T weight="600">{headline}</T>
        <T size={font.caption} tone="muted">
          {detail}
        </T>
      </View>
      <View
        accessible
        accessibilityLabel={[
          `${title} ${headline} ${detail}`,
          ...parts.map((part) => `${part.label} ${part.text}`),
        ].join(', ')}
      >
        <Bar parts={parts} total={total} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: 2 }}>
        {parts.map((part) => (
          <View
            key={part.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: part.value > 0 ? 1 : 0.5 }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: part.key === 'free' ? 'transparent' : part.color,
                borderWidth: part.key === 'free' ? 1 : 0,
                borderColor: c.placeholder,
              }}
            />
            <T size={font.caption} tone="muted">
              {part.label}
            </T>
            <T size={font.caption} tone="soft">
              {part.text}
            </T>
          </View>
        ))}
      </View>
    </View>
  )
}

/** The host's memory and CPU: Ramu's threads in the accent, Ramu itself deeper violet, other apps neutral. */
function HostMeters({ data }: { data: ResourceSnapshot }) {
  const { c } = useTheme()
  const say = useSay()
  const cores = Math.max(1, data.cores ?? 1)
  const threadBytes = data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
  const threadCpu = data.threads.reduce((sum, thread) => sum + thread.cpu, 0)
  const ramuCpu = data.ramuCpu ?? 0
  const allCpu = Math.max(data.hostCpu ?? 0, threadCpu + ramuCpu)
  const otherCpu = Math.max(0, allCpu - threadCpu - ramuCpu)
  const capacity = 100 * cores
  const memory = data.memory
  const split = memory ? memoryBreakdown(memory, threadBytes, data.ramuBytes) : null
  const low = memory ? isLowMemory(memory) : false
  return (
    <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.m }}>
      {memory && split ? (
        <Meter
          title={say('Memory')}
          headline={memorySize(memory.totalBytes - memory.availableBytes)}
          detail={say('of {0}', { 0: memorySize(memory.totalBytes) })}
          warning={low ? say('Low memory') : undefined}
          total={memory.totalBytes}
          parts={[
            {
              key: 'threads',
              label: say('Threads'),
              value: split.threads,
              text: memorySize(split.threads),
              color: c.accent,
            },
            { key: 'ramu', label: say('Ramu'), value: split.ramu, text: memorySize(split.ramu), color: c.primary },
            {
              key: 'other',
              label: say('Other apps'),
              value: split.other,
              text: memorySize(split.other),
              color: low ? c.warn : c.placeholder,
            },
            { key: 'free', label: say('Available'), value: split.free, text: memorySize(split.free), color: c.fill },
          ]}
        />
      ) : null}
      <Meter
        title={say('CPU')}
        headline={cpuPercent(allCpu, cores)}
        detail={cores === 1 ? say('of 1 core') : say('of {0} cores', { 0: cores })}
        total={capacity}
        parts={[
          {
            key: 'threads',
            label: say('Threads'),
            value: threadCpu,
            text: cpuPercent(threadCpu, cores),
            color: c.accent,
          },
          { key: 'ramu', label: say('Ramu'), value: ramuCpu, text: cpuPercent(ramuCpu, cores), color: c.primary },
          {
            key: 'other',
            label: say('Other apps'),
            value: otherCpu,
            text: cpuPercent(otherCpu, cores),
            color: c.placeholder,
          },
          {
            key: 'free',
            label: say('Idle'),
            value: Math.max(0, capacity - allCpu),
            text: cpuPercent(Math.max(0, capacity - allCpu), cores),
            color: c.fill,
          },
        ]}
      />
    </View>
  )
}

function ServerLine({ hostId, server }: { hostId: string; server: ThreadServer }) {
  const say = useSay()
  const store = useStore()
  const invoke = store.invoke as unknown as Invoke
  const origin = [server.owner.kind === 'agent' ? say('Agent') : server.owner.name, server.process].join(' · ')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingLeft: space.m }}>
      <View style={{ flex: 1 }}>
        <T size={font.control} numberOfLines={1}>{`localhost:${server.port}`}</T>
        <T size={font.caption} tone={server.orphaned ? 'warn' : 'muted'} numberOfLines={1}>
          {server.orphaned ? `${origin} · ${say('Outlived what started it')}` : origin}
        </T>
      </View>
      <Button
        kind="ghost"
        title={say('Stop')}
        accessibilityLabel={say('Stop {0}', { 0: `localhost:${server.port}` })}
        onPress={() => void invoke(hostId, 'servers.stop', server.taskId, server.pid, server.port).catch(() => {})}
      />
    </View>
  )
}

function ItemRow({ hostId, thread, item }: { hostId: string; thread: ThreadResources; item: ResourceItem }) {
  const say = useSay()
  const store = useStore()
  const invoke = store.invoke as unknown as Invoke
  const name = item.kind === 'agent' ? say('Agent') : item.name
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingLeft: space.m }}>
      <T size={font.caption} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
        {`${name} · ${memorySize(item.rssBytes)}`}
      </T>
      <Button
        kind="ghost"
        title={say('Stop')}
        accessibilityLabel={say('Stop {0}', { 0: name })}
        onPress={() => {
          const [method, ...args] = stopItemCall(thread.taskId, item)
          void invoke(hostId, method, ...args).catch(() => {})
        }}
      />
    </View>
  )
}

function ThreadRow({
  hostId,
  thread,
  divider,
  cores,
  servers,
}: {
  hostId: string
  thread: ThreadResources
  divider: boolean
  cores: number
  servers: ThreadServer[]
}) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const task = store.chats.find((chat) => chat.computerId === hostId && chat.taskId === thread.taskId)
  const activity = threadActivity(task, thread)
  const busy = isBusy(thread)
  const invoke = store.invoke as unknown as Invoke
  const stop = () => {
    setConfirming(false)
    void (async () => {
      for (const item of thread.items) {
        const [method, ...args] = stopItemCall(thread.taskId, item)
        await invoke(hostId, method, ...args)
      }
    })().catch(() => {})
  }
  const title =
    task?.title ??
    (isWorkspaceContext(thread.taskId) ? say('Project terminal') : (leftoverLabel(thread) ?? say('Untitled thread')))
  const pill =
    activity === 'working'
      ? { text: say('Working'), color: c.accent, background: c.accentWash }
      : activity === 'idle'
        ? { text: say('Idle'), color: c.muted, background: c.fill }
        : { text: say('Left running'), color: c.warn, background: c.warnWash }
  const details = thread.items.length + servers.length
  return (
    <View style={{ padding: space.m, gap: space.s, borderTopWidth: divider ? 0.5 : 0, borderTopColor: c.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ flex: 1, gap: 3 }}>
          <T weight="500" numberOfLines={1}>
            {title}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 }}>
            <View
              style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, backgroundColor: pill.background }}
            >
              <T size={font.caption} weight="500" style={{ color: pill.color }}>
                {pill.text}
              </T>
            </View>
            {busy ? (
              <T size={font.caption} tone="warn">
                {say('Busy')}
              </T>
            ) : null}
            {servers.length ? (
              <T size={font.caption} tone="accent" numberOfLines={1} style={{ flexShrink: 1 }}>
                {servers.map((server) => `:${server.port}`).join(' ')}
              </T>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T size={font.caption} tone="soft">
            {memorySize(thread.rssBytes)}
          </T>
          <T size={font.caption} tone={busy ? 'warn' : 'muted'}>
            {say('{0} CPU', { 0: cpuPercent(thread.cpu, cores) })}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {confirming ? (
          <Button kind="danger" title={say('Stop {0}?', { 0: title })} onPress={stop} />
        ) : (
          <Button
            kind="secondary"
            title={say('Stop')}
            accessibilityLabel={say('Stop everything {0} left running', { 0: title })}
            onPress={() => (activity === 'working' ? setConfirming(true) : stop())}
          />
        )}
        {details ? (
          <Button kind="ghost" title={open ? say('Hide') : say('Details')} onPress={() => setOpen((value) => !value)} />
        ) : null}
      </View>
      {open ? thread.items.map((item) => <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} />) : null}
      {open
        ? servers.map((server) => <ServerLine key={`${server.pid}:${server.port}`} hostId={hostId} server={server} />)
        : null}
    </View>
  )
}

/** The same meters, threads and Stop as the desktop's Resources panel; hidden when a host gives no reading. */
/**
 * Stops the agents of every thread with no turn in progress, which hold memory between turns; each starts again with the
 * thread's next message. Servers and terminals keep running: they may be in use.
 */
function StopIdleAgents({ hostId, threads }: { hostId: string; threads: readonly ThreadResources[] }) {
  const say = useSay()
  const store = useStore()
  const [stopping, setStopping] = useState(false)
  const idle = idleAgents(threads)
  if (!idle.taskIds.length) return null
  return (
    <View style={{ gap: space.xs }}>
      <Button
        kind="secondary"
        title={
          stopping
            ? say('Stopping…')
            : say('Stop {0} idle agents · {1}', { 0: idle.taskIds.length, 1: memorySize(idle.bytes) })
        }
        disabled={stopping}
        onPress={() => {
          setStopping(true)
          void stopIdleThreads(store.invoke as Parameters<typeof stopIdleThreads>[0], hostId, idle.taskIds)
            .catch((error) => showError(error instanceof Error ? error.message : String(error)))
            .finally(() => setStopping(false))
        }}
      />
      <T size={font.caption} tone="muted" style={{ textAlign: 'center' }}>
        {say('Each starts again with its thread’s next message. Servers and terminals keep running.')}
      </T>
    </View>
  )
}

export function HostResources({ host }: { host: string | null }) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const snapshots = useSnapshots(host)
  return (
    <>
      {snapshots.map(({ id, data, servers }) => {
        const cores = Math.max(1, data.cores ?? 1)
        return (
          <Section key={id} title={store.computers.find((pc) => pc.id === id)?.name ?? ''}>
            <HostMeters data={data} />
            <StopIdleAgents hostId={id} threads={data.threads} />
            <Group>
              {data.threads.map((thread, index) => (
                <ThreadRow
                  key={thread.taskId}
                  hostId={id}
                  thread={thread}
                  divider={index > 0}
                  cores={cores}
                  servers={servers.filter((server) => server.taskId === thread.taskId)}
                />
              ))}
              {!data.threads.length ? (
                <T size={font.caption} tone="muted" style={{ padding: space.m }}>
                  {say('No thread is running anything')}
                </T>
              ) : null}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.m,
                  padding: space.m,
                  borderTopWidth: 0.5,
                  borderTopColor: c.line,
                }}
              >
                <View style={{ flex: 1 }}>
                  <T tone="soft">{say('Ramu')}</T>
                  <T size={font.caption} tone="muted" numberOfLines={1}>
                    {say('The service, the app and its browser')}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T size={font.caption} tone="soft">
                    {memorySize(data.ramuBytes)}
                  </T>
                  <T size={font.caption} tone="muted">
                    {say('{0} CPU', { 0: cpuPercent(data.ramuCpu ?? 0, cores) })}
                  </T>
                </View>
              </View>
            </Group>
          </Section>
        )
      })}
    </>
  )
}
