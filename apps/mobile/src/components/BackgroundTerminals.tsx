import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View, useWindowDimensions } from 'react-native'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import { translate } from '@ramu/shared/i18n'
import { TerminalOutputBuffer, unseenOutput, type TerminalChunk } from '@ramu/shared/workspace/terminalOutput'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useOpenTerminalLink } from '../runtime/openFile'
import { providerCommands } from '../runtime/threadActivity'
import { HelperDetails } from './Helpers'
import { font, space, useTheme } from '../theme'
import { Button, Card, Divider, Row, Sheet, T } from './ui'
import TerminalView from './TerminalView'
import { ActivityPill } from './ActivityPill'
import { ChevronRight, SquareTerminal } from 'lucide-react-native'
import { formatDuration } from '../runtime/turns'
import { Breathe } from './Motion'

type Status = 'loading' | 'ready' | 'offline' | 'error'
type Inspection = BackgroundTerminalInfo & { output: string }
const MAX_OUTPUT = 64_000
/** A command short enough for a pill: its first line, clipped. */
const clipCommand = (command: string) => {
  const line = command.trim().split('\n')[0] ?? ''
  return line.length > 28 ? `${line.slice(0, 27)}…` : line
}
const live = (command: BackgroundTerminalInfo) => command.state === 'running' || command.state === 'stopping'

/**
 * One command in the list: a dot that breathes while it runs (in the attention colour when the agent is waiting on it),
 * what it is, its state, how long it has run, and a chevron to its output.
 */
function commandRow(
  c: ReturnType<typeof useTheme>['c'],
  {
    title,
    mono = false,
    waiting,
    detail,
    since,
    say,
    onPress,
  }: {
    title: string
    /** A command line reads in the terminal's type; a command the agent named reads as its name. */
    mono?: boolean
    waiting: boolean
    detail: string
    since?: number
    say: (text: string) => string
    onPress(): void
  },
) {
  const ran = since ? formatDuration(Date.now() - since) : ''
  const state = waiting ? `${say('Agent is waiting')} · ${detail}` : detail
  return (
    <Row
      accessibilityRole="button"
      accessibilityLabel={`${title} · ${state}${ran ? ` · ${ran}` : ''}`}
      onPress={onPress}
    >
      <Breathe active>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: waiting ? c.warn : c.ok }} />
      </Breathe>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T mono={mono} weight={mono ? '400' : '500'} numberOfLines={2}>
          {title}
        </T>
        <T size={font.caption} tone={waiting ? 'warn' : 'muted'} numberOfLines={2}>
          {state}
        </T>
      </View>
      {ran ? (
        <T size={font.caption} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
          {ran}
        </T>
      ) : null}
      <ChevronRight size={16} color={c.muted} />
    </Row>
  )
}

/** Inspect existing host-owned commands. This surface never opens, writes to or closes a shell. */
export function BackgroundTerminals({
  chat,
  open,
  onOpen,
  onClose,
}: {
  chat: Chat
  open: boolean
  onOpen(): void
  onClose(): void
}) {
  const store = useStore()
  const { c } = useTheme()
  const { height } = useWindowDimensions()
  const commands = providerCommands(chat)
  // A command the provider runs opens in the helper sheet, which shows its output and stops it through the agent.
  const [commandId, setCommandId] = useState<string | null>(null)
  const openCommand = commands.find((task) => task.agentId === commandId)
  const hostId = chat.computerId,
    taskId = chat.taskId,
    scope = `${hostId}:${taskId}`
  const openTerminalLink = useOpenTerminalLink(hostId, taskId)
  const online = store.isOnline(hostId)
  const t = (text: string, params?: Record<string, string | number>) => translate(store.language, text, params)
  const io = useRef({ invoke: store.invoke, subscribe: store.subscribe })
  io.current = { invoke: store.invoke, subscribe: store.subscribe }
  const current = useRef({ scope, open, online })
  current.current = { scope, open, online }
  const [list, setList] = useState<{ scope: string; rows: BackgroundTerminalInfo[]; status: Status; error?: string }>({
    scope,
    rows: [],
    status: online ? 'loading' : 'offline',
  })
  const listRef = useRef(list)
  listRef.current = list
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null)
  const selected = selection?.scope === scope ? selection.id : null
  const detailKey = `${scope}:${selected ?? ''}`
  const [detail, setDetail] = useState<{ key: string; status: Status; record?: Inspection; error?: string }>({
    key: detailKey,
    status: 'loading',
  })
  const detailRef = useRef(detail)
  detailRef.current = detail
  const refresh = useRef<{ scope: string; run: () => Promise<void> } | null>(null)
  const inspect = useRef<{ key: string; run: () => Promise<void> } | null>(null)
  const generation = useRef(0)
  const acting = useRef(false)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const valid = (source: string, epoch: number) =>
    current.current.scope === source && current.current.open && current.current.online && generation.current === epoch
  useEffect(() => {
    let active = true,
      revision = 0
    let previous = listRef.current.scope === scope ? listRef.current.rows : []
    const load = async () => {
      const mine = ++revision
      if (!online) {
        setList({ scope, rows: previous, status: 'offline' })
        return
      }
      setList({ scope, rows: previous, status: 'loading' })
      try {
        const all = await io.current.invoke(hostId, 'term.background.list', taskId)
        if (!active || mine !== revision) return
        if (all.some((row) => row.taskId !== taskId))
          throw new Error('Background command details changed. Refresh before continuing.')
        // Only commands still running are listed; how a finished one ended stays in the thread's transcript.
        const rows = all.filter(live)
        previous = rows
        setList({ scope, rows, status: 'ready' })
      } catch (error) {
        if (active && mine === revision)
          setList({
            scope,
            rows: previous,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
      }
    }
    refresh.current = { scope, run: load }
    void load()
    const off = io.current.subscribe(hostId, (channel, value) => {
      if (channel === 'term:changed' && value.taskId === taskId) void load()
    })
    return () => {
      active = false
      off()
    }
  }, [scope, hostId, taskId, online])
  useEffect(() => {
    const epoch = ++generation.current
    acting.current = false
    setPending(false)
    setActionError(null)
    if (!open || !selected)
      return () => {
        generation.current = epoch + 1
      }
    let active = true,
      revision = 0,
      hydrating = true
    let record = detailRef.current.key === detailKey ? detailRef.current.record : undefined
    const buffer = new TerminalOutputBuffer({ maxChars: MAX_OUTPUT, perTerminal: MAX_OUTPUT, terminals: 1 })
    const apply = (chunk: TerminalChunk) => {
      if (!record) return
      const unseen = unseenOutput(chunk, record.cursor)
      if (!unseen) return
      record = {
        ...record,
        output: ((unseen.reset ? '' : record.output) + unseen.data).slice(-MAX_OUTPUT),
        cursor: chunk.cursor ?? record.cursor + unseen.data.length,
      }
      setDetail({ key: detailKey, status: 'ready', record })
    }
    const load = async () => {
      const mine = ++revision
      if (!online) {
        setDetail({ key: detailKey, record, status: 'offline' })
        return
      }
      hydrating = true
      setDetail({ key: detailKey, record, status: 'loading' })
      try {
        const result = await io.current.invoke(hostId, 'term.background.inspect', taskId, selected)
        if (!active || mine !== revision || generation.current !== epoch) return
        if (result.id !== selected || result.taskId !== taskId)
          throw new Error('Background command details changed. Refresh before continuing.')
        record = { ...result, output: result.output.slice(-MAX_OUTPUT) }
        hydrating = false
        setDetail({ key: detailKey, status: 'ready', record })
        buffer.drain().forEach(apply)
      } catch (error) {
        if (active && mine === revision)
          setDetail({
            key: detailKey,
            record,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
      }
    }
    inspect.current = { key: detailKey, run: load }
    const off = io.current.subscribe(hostId, (channel, value) => {
      if (!active) return
      if (channel === 'term:changed' && value.taskId === taskId) void load()
      if (channel === 'term:exit' && value.id === selected) void load()
      if (channel === 'term:data' && value.id === selected && typeof value.data === 'string') {
        const chunk: TerminalChunk = {
          id: selected,
          data: value.data,
          ...(typeof value.cursor === 'number' ? { cursor: value.cursor } : {}),
        }
        if (hydrating) buffer.add(chunk)
        else apply(chunk)
      }
    })
    void load()
    return () => {
      active = false
      generation.current = epoch + 1
      acting.current = false
      off()
    }
  }, [scope, hostId, taskId, open, selected, detailKey, online])

  const rows = list.scope === scope ? list.rows : []
  // A command that ends leaves the list: its view goes back to the list, and the sheet closes once nothing runs.
  const ready = list.scope === scope && list.status === 'ready'
  useEffect(() => {
    if (!ready) return
    if (selected && !rows.some((row) => row.id === selected)) setSelection(null)
    if (open && !rows.length && !commands.length) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the host's list changes
  }, [ready, rows, selected, open])
  const awaited = rows.find((row) => row.agentWaiting) ?? commands.find((task) => task.awaited)
  const shown = detail.key === detailKey ? detail.record : undefined
  const canControl =
    open &&
    online &&
    list.scope === scope &&
    list.status === 'ready' &&
    detail.key === detailKey &&
    detail.status === 'ready'
  const stop = async (command: BackgroundTerminalInfo, force: boolean, epoch: number) => {
    if (!valid(scope, epoch) || acting.current || !canControl) return
    acting.current = true
    setPending(true)
    setActionError(null)
    try {
      const fresh = await io.current.invoke(hostId, 'term.background.inspect', taskId, command.id)
      if (!valid(scope, epoch)) return
      if (fresh.id !== command.id || fresh.taskId !== taskId)
        throw new Error('Background command details changed. Refresh before continuing.')
      if (!live(fresh) || !fresh.capabilities.stop)
        throw new Error('This command has no live process to control. Saved output is read-only.')
      if (force && (fresh.state !== 'stopping' || !fresh.capabilities.forceStop))
        throw new Error('Try a normal stop before force stop.')
      if (!force && fresh.state === 'stopping') return
      await io.current.invoke(hostId, 'term.background.stop', taskId, command.id, force)
    } catch (error) {
      if (valid(scope, epoch)) setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      if (valid(scope, epoch)) {
        acting.current = false
        setPending(false)
        if (refresh.current?.scope === scope) void refresh.current.run()
        if (inspect.current?.key === detailKey) void inspect.current.run()
      }
    }
  }
  const forceStop = (command: BackgroundTerminalInfo) => {
    const epoch = generation.current
    Alert.alert(
      t('Force stop'),
      `${command.command}\n\n${t('Force stop ends the command immediately without letting it clean up.')}`,
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Force stop'),
          style: 'destructive',
          onPress: () => {
            void stop(command, true, epoch)
          },
        },
      ],
    )
  }
  const stateLabel = (command: BackgroundTerminalInfo) => t(command.state === 'stopping' ? 'Stopping' : 'Running')
  const stopLabel = (command: BackgroundTerminalInfo) =>
    `${command.startedBy ? ` · ${t('Started by a sub-agent')}` : ''}${
      command.stoppedBy
        ? ` · ${t(command.stoppedBy === 'user' ? 'Stop requested by you' : 'Stop requested by agent')}`
        : ''
    }`
  const retry = () => {
    if (refresh.current?.scope === scope) void refresh.current.run()
    if (selected && inspect.current?.key === detailKey) void inspect.current.run()
  }
  const status = selected
    ? detail.key === detailKey
      ? detail.status
      : 'loading'
    : list.scope === scope
      ? list.status
      : 'loading'
  return (
    <>
      {!!(rows.length + commands.length) && (
        <ActivityPill
          icon={SquareTerminal}
          // A fixed name and a count, as the desktop's chip, so the row above the message box holds still. While the
          // agent waits on a command the chip takes the attention colour; the working line says which command.
          label={`${t('Terminals')} · ${rows.length + commands.length}`}
          accessibilityLabel={
            awaited
              ? `${t('Background terminals')}, ${t('Waiting on {0}', { 0: clipCommand('command' in awaited ? awaited.command : awaited.name) })}`
              : t('Background terminals')
          }
          tone={awaited ? 'attention' : 'quiet'}
          onPress={onOpen}
        />
      )}
      <Sheet
        open={open}
        onClose={onClose}
        title={selected ? t('Command') : t('Background terminals')}
        // A command's output is one level down in this sheet: the back arrow returns to the list.
        onBack={selected ? () => setSelection(null) : undefined}
      >
        <View style={{ padding: space.l, gap: space.s }}>
          {/* The sheet belongs to the thread on screen and follows the host by itself, so it names neither and has no
              Refresh; a read that failed offers to try again. */}
          {!online && <T tone="muted">{t('Offline · last-known activity')}</T>}
          {status === 'loading' && !rows.length && !commands.length && (
            <ActivityIndicator accessibilityLabel={t('Loading background commands…')} />
          )}
          {status === 'error' && (
            <View style={{ gap: space.xs }}>
              <T tone="bad">{t((selected ? detail.error : list.error) ?? 'Could not load background commands.')}</T>
              <Button kind="ghost" title={t('Try again')} disabled={!online} onPress={retry} />
            </View>
          )}
          {actionError && <T tone="bad">{t(actionError)}</T>}
          {selected ? (
            <>
              {shown && (
                <>
                  <T mono copyable={shown.command} numberOfLines={3}>
                    {shown.command}
                  </T>
                  <T mono size={font.caption} tone="muted" numberOfLines={2} copyable={shown.cwd}>
                    {shown.cwd}
                  </T>
                  <T size={font.caption} tone="muted">
                    {stateLabel(shown)}
                    {stopLabel(shown)} ·{' '}
                    {new Date(shown.startedAt).toLocaleString(store.language === 'id' ? 'id-ID' : 'en-US')}
                  </T>
                  {shown.cursor > shown.output.length && (
                    <T tone="muted" size={font.caption}>
                      {t('Showing the most recent terminal output. Older output was truncated.')}
                    </T>
                  )}
                  <View style={{ height: Math.max(160, Math.min(360, height * 0.35)) }}>
                    <TerminalView
                      session={detailKey}
                      output={shown.output}
                      cursor={shown.cursor}
                      enabled={false}
                      onInput={() => {}}
                      onResize={() => {}}
                      onLink={(kind, text) => void openTerminalLink(kind, text, shown.cwd)}
                    />
                  </View>
                  <T size={font.caption} tone="muted">
                    {t('Output is read-only. Closing this sheet never stops a command.')}
                  </T>
                  {live(shown) && shown.capabilities.stop && (
                    <Button
                      kind="secondary"
                      title={t(shown.state === 'stopping' ? 'Stopping' : 'Stop')}
                      disabled={!canControl || pending || shown.state === 'stopping'}
                      onPress={() => {
                        void stop(shown, false, generation.current)
                      }}
                    />
                  )}
                  {shown.state === 'stopping' && shown.capabilities.forceStop && (
                    <Button
                      kind="danger"
                      title={t('Force stop')}
                      disabled={!canControl || pending}
                      onPress={() => forceStop(shown)}
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {status === 'ready' && !rows.length && !commands.length && (
                <T tone="muted">{t('No tracked background commands in this thread.')}</T>
              )}
              {rows.length ? (
                <Card>
                  {rows.map((command, index) => (
                    <View key={command.id}>
                      {index ? <Divider inset={space.l} /> : null}
                      {commandRow(c, {
                        title: command.command,
                        mono: true,
                        waiting: !!command.agentWaiting,
                        detail: `${stateLabel(command)}${stopLabel(command)}`,
                        since: command.startedAt,
                        say: t,
                        onPress: () => setSelection({ scope, id: command.id }),
                      })}
                    </View>
                  ))}
                </Card>
              ) : null}
              {commands.length ? (
                <Card>
                  {commands.map((task, index) => (
                    <View key={task.agentId}>
                      {index ? <Divider inset={space.l} /> : null}
                      {commandRow(c, {
                        title: task.name,
                        waiting: !!task.awaited,
                        detail: `${t('Running')} · ${t('Moved to the background')}`,
                        since: task.startedAt,
                        say: t,
                        onPress: () => {
                          onClose()
                          // iOS presents the next sheet only once this one has gone.
                          setTimeout(() => setCommandId(task.agentId), 300)
                        },
                      })}
                    </View>
                  ))}
                </Card>
              ) : null}
            </>
          )}
        </View>
      </Sheet>
      {openCommand ? <HelperDetails task={openCommand} chat={chat} onClose={() => setCommandId(null)} /> : null}
    </>
  )
}
