import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  cpuShare,
  gigabytes,
  isBusy,
  isLowMemory,
  memoryBreakdown,
  stopItemCall,
  threadActivity,
  type ResourceItem,
  type ResourceSnapshot,
  type ThreadResources,
} from '@ramu/shared/resources'
import type { ThreadServer } from '@ramu/shared/servers'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'
import { Group, Section } from './InboxParts'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const POLL_MS = 5000

/** Figures for each online owner host, read only while the Resources sheet is open. */
function useSnapshots(host: string | null) {
  const store = useStore()
  const ids = store.computers
    .filter((pc) => pc.status === 'online' && pc.access !== 'viewer' && (!host || pc.id === host))
    .map((pc) => pc.id)
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

/** One thin bar of coloured parts on a quiet track, as on the desktop. */
function Bar({ parts, height = 6 }: { parts: { key: string; value: number; color: string }[]; height?: number }) {
  const { c } = useTheme()
  const total = Math.max(
    1,
    parts.reduce((sum, part) => sum + part.value, 0),
  )
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height, overflow: 'hidden', backgroundColor: c.fill }}>
      {parts.map((part) => (
        <View key={part.key} style={{ width: share(part.value, total), backgroundColor: part.color }} />
      ))}
    </View>
  )
}

/** The host's memory: Ramu's threads in the accent, Ramu itself lighter, other apps neutral, then what is free. */
function HostMeter({ data }: { data: ResourceSnapshot }) {
  const { c } = useTheme()
  const say = useSay()
  const memory = data.memory!
  const threads = data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
  const split = memoryBreakdown(memory, threads, data.ramuBytes)
  const low = isLowMemory(memory)
  const parts = [
    { key: 'threads', label: say('Threads'), value: split.threads, color: c.accent },
    { key: 'ramu', label: say('Ramu'), value: split.ramu, color: c.accentSoft },
    { key: 'other', label: say('Other apps'), value: split.other, color: low ? c.warn : c.lineStrong },
    { key: 'free', label: say('Available'), value: split.free, color: 'transparent' },
  ]
  const cpu = data.threads.reduce((sum, thread) => sum + thread.cpu, 0)
  return (
    <View style={{ paddingHorizontal: space.l, paddingBottom: space.s, gap: space.xs }}>
      <T size={font.caption} tone={low ? 'warn' : 'muted'}>
        {[
          say('{0} of {1} GB used', {
            0: gigabytes(memory.totalBytes - memory.availableBytes),
            1: gigabytes(memory.totalBytes),
          }),
          low ? say('Low memory') : '',
          // The whole host's CPU, with Ramu's part of it, as Activity Monitor would add it up.
          say('CPU {0}% (Ramu {1}%)', {
            0: Math.round(cpuShare(Math.max(data.hostCpu ?? 0, cpu), data.cores) * 100),
            1: Math.round(cpuShare(cpu + (data.ramuCpu ?? 0), data.cores) * 100),
          }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </T>
      <View
        accessible
        accessibilityLabel={parts
          .map((part) => `${part.label} ${say('{0} GB', { 0: gigabytes(part.value) })}`)
          .join(', ')}
      >
        <Bar parts={parts} height={8} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, rowGap: 2 }}>
        {parts.slice(0, 3).map((part) => (
          <View key={part.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: part.color }} />
            <T size={font.caption} tone="muted">
              {`${part.label} ${gigabytes(part.value)}`}
            </T>
          </View>
        ))}
      </View>
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
        {`${name} · ${say('{0} GB', { 0: gigabytes(item.rssBytes) })}`}
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
  heaviest,
  servers,
}: {
  hostId: string
  thread: ThreadResources
  divider: boolean
  heaviest: number
  servers: ThreadServer[]
}) {
  const { c } = useTheme()
  const say = useSay()
  const store = useStore()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const task = store.chats.find((chat) => chat.computerId === hostId && chat.taskId === thread.taskId)
  const activity = threadActivity(task, thread)
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
  const title = task?.title ?? say('Thread')
  const state = activity === 'working' ? say('Working') : activity === 'idle' ? say('Idle') : say('Still running')
  return (
    <View style={{ padding: space.m, gap: space.xs, borderTopWidth: divider ? 0.5 : 0, borderTopColor: c.line }}>
      <T weight="500" numberOfLines={1}>
        {title}
      </T>
      <T size={font.caption} tone={activity === 'left-running' ? 'warn' : 'muted'}>
        {[state, isBusy(thread) ? say('Busy') : '', say('{0} GB', { 0: gigabytes(thread.rssBytes) })]
          .filter(Boolean)
          .join(' · ')}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ flex: 1 }}>
          <Bar
            parts={[
              { key: 'used', value: thread.rssBytes, color: c.accent },
              { key: 'rest', value: Math.max(0, heaviest - thread.rssBytes), color: 'transparent' },
            ]}
            height={4}
          />
        </View>
        <View style={{ width: 36 }}>
          <Bar
            parts={[
              { key: 'cpu', value: cpuShare(thread.cpu), color: isBusy(thread) ? c.warn : c.soft },
              { key: 'rest', value: 1 - cpuShare(thread.cpu), color: 'transparent' },
            ]}
            height={4}
          />
        </View>
        <T size={font.caption} tone={isBusy(thread) ? 'warn' : 'muted'} style={{ width: 40, textAlign: 'right' }}>
          {`${Math.round(thread.cpu)}%`}
        </T>
      </View>
      {servers.length ? (
        <T size={font.caption} tone="accent">
          {servers.map((server) => `localhost:${server.port}`).join(' · ')}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {confirming ? (
          <Button kind="danger" title={say('Stop {0}?', { 0: title })} onPress={stop} />
        ) : (
          <Button
            kind="secondary"
            title={say('Stop')}
            onPress={() => (activity === 'working' ? setConfirming(true) : stop())}
          />
        )}
        <Button kind="ghost" title={open ? say('Hide') : say('Details')} onPress={() => setOpen((value) => !value)} />
      </View>
      {open ? thread.items.map((item) => <ItemRow key={item.id} hostId={hostId} thread={thread} item={item} />) : null}
      {open
        ? servers.map((server) => <ServerLine key={`${server.pid}:${server.port}`} hostId={hostId} server={server} />)
        : null}
    </View>
  )
}

/** The same host line, figures and Stop as the desktop's Resources panel; hidden when a host gives no reading. */
export function HostResources({ host }: { host: string | null }) {
  const say = useSay()
  const store = useStore()
  const snapshots = useSnapshots(host)
  return (
    <>
      {snapshots.map(({ id, data, servers }) => {
        const total = data.ramuBytes + data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
        const heaviest = Math.max(0, ...data.threads.map((thread) => thread.rssBytes))
        return (
          <Section key={id} title={store.computers.find((pc) => pc.id === id)?.name ?? ''}>
            {data.memory ? (
              <HostMeter data={data} />
            ) : (
              <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
                {say('Ramu {0} GB', { 0: gigabytes(total) })}
              </T>
            )}
            {data.threads.length ? (
              <Group>
                {data.threads.map((thread, index) => (
                  <ThreadRow
                    key={thread.taskId}
                    hostId={id}
                    thread={thread}
                    divider={index > 0}
                    heaviest={heaviest}
                    servers={servers.filter((server) => server.taskId === thread.taskId)}
                  />
                ))}
              </Group>
            ) : null}
          </Section>
        )
      })}
    </>
  )
}
