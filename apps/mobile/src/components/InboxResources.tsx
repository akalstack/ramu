import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  gigabytes,
  isBusy,
  isLowMemory,
  stopItemCall,
  threadActivity,
  type ResourceItem,
  type ResourceSnapshot,
  type ThreadResources,
} from '@ramu/shared/resources'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Button, T } from './ui'
import { Group, Section } from './InboxParts'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const POLL_MS = 5000

/** Figures for each online owner host, read only while the Running tab is on screen. */
function useSnapshots(host: string | null) {
  const store = useStore()
  const ids = store.computers
    .filter((pc) => pc.status === 'online' && pc.access !== 'viewer' && (!host || pc.id === host))
    .map((pc) => pc.id)
  const key = ids.join(',')
  const [snapshots, setSnapshots] = useState<Record<string, ResourceSnapshot>>({})
  useEffect(() => {
    const read = () => {
      for (const id of key ? key.split(',') : [])
        void store
          .invoke(id, 'resources.snapshot')
          .then((snapshot) => setSnapshots((current) => ({ ...current, [id]: snapshot })))
          .catch(() => setSnapshots(({ [id]: _gone, ...rest }) => rest))
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => clearInterval(timer)
  }, [key, store.invoke]) // eslint-disable-line react-hooks/exhaustive-deps -- `invoke` is the only part of the store read here
  return ids.flatMap((id) => (snapshots[id] ? [{ id, data: snapshots[id] }] : []))
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

function ThreadRow({ hostId, thread, divider }: { hostId: string; thread: ThreadResources; divider: boolean }) {
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
    </View>
  )
}

/** The same host line, figures and Stop as the desktop's Running tab; hidden when a host gives no reading. */
export function InboxResources({ host }: { host: string | null }) {
  const say = useSay()
  const store = useStore()
  const snapshots = useSnapshots(host)
  return (
    <>
      {snapshots.map(({ id, data }) => {
        const memory = data.memory
        const total = data.ramuBytes + data.threads.reduce((sum, thread) => sum + thread.rssBytes, 0)
        const line = [
          memory
            ? say('{0} of {1} GB used', {
                0: gigabytes(memory.totalBytes - memory.availableBytes),
                1: gigabytes(memory.totalBytes),
              })
            : '',
          say('Ramu {0} GB', { 0: gigabytes(total) }),
          memory && isLowMemory(memory) ? say('Low memory') : '',
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <Section key={id} title={store.computers.find((pc) => pc.id === id)?.name ?? ''}>
            <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingBottom: space.s }}>
              {line}
            </T>
            {data.threads.length ? (
              <Group>
                {data.threads.map((thread, index) => (
                  <ThreadRow key={thread.taskId} hostId={id} thread={thread} divider={index > 0} />
                ))}
              </Group>
            ) : null}
          </Section>
        )
      })}
    </>
  )
}
