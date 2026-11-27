import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Globe, Server, Unplug } from 'lucide-react-native'
import { serverUrl, type ThreadServer } from '@ramu/shared/servers'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, space, useTheme } from '../theme'
import { ActivityPill } from './ActivityPill'
import { Button, Card, Divider, Row, Sheet, T } from './ui'

const POLL_MS = 3000

/** "localhost:3000", as the person would type it. */
export const serverAddress = (server: Pick<ThreadServer, 'port' | 'host'>) => serverUrl(server).replace('http://', '')

/**
 * What a thread's work is listening on, as the desktop lists it above the composer: a pill while there are some, and a
 * sheet to open one in the thread's browser or stop it. Read only while the thread is on screen; a view-only device
 * neither reads nor stops them.
 */
export function ThreadServers({
  chat,
  open,
  onOpen,
  onClose,
  onOpenPage,
}: {
  chat: Chat
  open: boolean
  onOpen(): void
  onClose(): void
  /** Opens a page in the thread's browser on the host, where a localhost address resolves. */
  onOpenPage(url: string): void
}) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const hostId = chat.computerId
  const taskId = chat.taskId
  const online = store.isOnline(hostId)
  const owner = store.computers.find((computer) => computer.id === hostId)?.access !== 'viewer'
  const invoke = useRef(store.invoke)
  invoke.current = store.invoke
  const sheet = useRef({ open, onClose })
  sheet.current = { open, onClose }
  const [servers, setServers] = useState<ThreadServer[]>([])
  const [stopping, setStopping] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setServers([])
    if (!online || !owner || !taskId) return
    let active = true
    const read = () =>
      void invoke.current(hostId, 'servers.list', taskId).then(
        (list) => {
          // Build daemons are not servers to open; Resources lists them, and Ramu stops them once the thread rests.
          if (!active) return
          const mine = list.filter((server) => server.taskId === taskId && !server.daemon)
          setServers(mine)
          // The last server stopped (here or by the agent): the sheet closes rather than staying open on nothing.
          if (!mine.length && sheet.current.open) sheet.current.onClose()
        },
        // A host without the call, or a read that failed, shows nothing rather than a stale list.
        () => {
          if (active) setServers([])
        },
      )
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [hostId, taskId, online, owner, revision])
  if (!servers.length && !open) return null
  const key = (server: ThreadServer) => `${server.pid}:${server.port}`
  const stop = (server: ThreadServer) => {
    setStopping(key(server))
    setError(null)
    void invoke
      .current(hostId, 'servers.stop', server.taskId, server.pid, server.port)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        setStopping(null)
        setRevision((value) => value + 1)
      })
  }
  const first = servers[0]
  return (
    <>
      {first ? (
        <ActivityPill
          // The browser's own pill wears the globe; a server is a server, as on the desktop.
          icon={Server}
          // A fixed name and a count, as the desktop's chip: a label that changed with each server moved the row.
          label={`${say('Servers')} · ${servers.length}`}
          accessibilityLabel={`${say('Servers')}, ${servers.map(serverAddress).join(', ')}`}
          onPress={onOpen}
        />
      ) : null}
      <Sheet open={open} onClose={onClose} title={say('Servers')}>
        <View style={{ padding: space.l, gap: space.s }}>
          <T size={font.caption} tone="muted">
            {say(
              'What this thread’s agent, terminals and commands are listening on. Open one in the thread’s browser.',
            )}
          </T>
          {error ? <T tone="bad">{error}</T> : null}
          {servers.length ? (
            <Card>
              {servers.map((server, index) => {
                const address = serverAddress(server)
                const origin = [server.owner.kind === 'agent' ? say('Agent') : server.owner.name, server.process]
                  .filter(Boolean)
                  .join(' · ')
                const Icon = server.web ? Globe : Unplug
                return (
                  <View key={key(server)}>
                    {index ? <Divider inset={space.l + 28} /> : null}
                    <Row
                      accessibilityRole={server.web ? 'button' : undefined}
                      accessibilityLabel={server.web ? say('Open {0}', { 0: address }) : address}
                      accessibilityHint={server.web ? undefined : say('Not a web page')}
                      onPress={
                        server.web
                          ? () => {
                              onClose()
                              onOpenPage(serverUrl(server))
                            }
                          : undefined
                      }
                      style={{ paddingVertical: space.m, paddingRight: space.s }}
                    >
                      <Icon size={16} color={c.muted} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T weight="500" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
                          {address}
                        </T>
                        <T size={font.caption} tone={server.orphaned ? 'warn' : 'muted'} numberOfLines={1}>
                          {server.orphaned ? `${origin} · ${say('Outlived what started it')}` : origin}
                        </T>
                      </View>
                      <Button
                        kind="ghost"
                        title={stopping === key(server) ? say('Stopping') : say('Stop')}
                        accessibilityLabel={say('Stop {0}', { 0: address })}
                        disabled={!online || stopping !== null}
                        onPress={() => stop(server)}
                      />
                    </Row>
                  </View>
                )
              })}
            </Card>
          ) : (
            <T tone="muted">{say('Nothing in this thread is listening now.')}</T>
          )}
        </View>
      </Sheet>
    </>
  )
}
