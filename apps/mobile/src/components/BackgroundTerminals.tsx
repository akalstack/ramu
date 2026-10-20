import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, View, useWindowDimensions } from 'react-native'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import { translate } from '@ramu/shared/i18n'
import { TerminalOutputBuffer, unseenOutput, type TerminalChunk } from '@ramu/shared/workspace/terminalOutput'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { isMethodMissing } from '../runtime/goalVerify'
import { font, space } from '../theme'
import { Button, Row, Sheet, T } from './ui'
import TerminalView from './TerminalView'

type Status = 'loading' | 'ready' | 'offline' | 'unsupported' | 'error'
type Inspection = BackgroundTerminalInfo & { output: string }
const MAX_OUTPUT = 64_000
const live = (command: BackgroundTerminalInfo) => command.state === 'running' || command.state === 'stopping'

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
  const { height } = useWindowDimensions()
  const hostId = chat.computerId,
    taskId = chat.taskId,
    scope = `${hostId}:${taskId}`
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
        const rows = await io.current.invoke(hostId, 'term.background.list', taskId)
        if (!active || mine !== revision) return
        if (rows.some((row) => row.taskId !== taskId))
          throw new Error('Background command details changed. Refresh before continuing.')
        previous = rows
        setList({ scope, rows, status: 'ready' })
      } catch (error) {
        if (active && mine === revision)
          setList({
            scope,
            rows: previous,
            status: isMethodMissing(error) ? 'unsupported' : 'error',
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
            status: isMethodMissing(error) ? 'unsupported' : 'error',
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
        throw new Error('This command has no controllable live process. Saved output is read-only.')
      if (force && (fresh.state !== 'stopping' || !fresh.capabilities.forceStop))
        throw new Error('Request graceful stop before force stop.')
      if (!force && fresh.state === 'stopping') return
      await io.current.invoke(hostId, 'term.background.stop', taskId, command.id, force)
    } catch (error) {
      if (valid(scope, epoch))
        setActionError(
          isMethodMissing(error)
            ? 'Update Ramu on this host to manage background commands.'
            : error instanceof Error
              ? error.message
              : String(error),
        )
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
  const stateLabel = (command: BackgroundTerminalInfo) =>
    t(
      { running: 'Running', stopping: 'Stopping', exited: 'Exited', failed: 'Failed', unknown: 'Unknown' }[
        command.state
      ] ?? 'Unknown',
    )
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
      {!!rows.length && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Background terminals')}
          onPress={onOpen}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.m }}
        >
          <T size={font.caption}>{t('{0} background terminals', { 0: rows.filter(live).length || rows.length })}</T>
        </Pressable>
      )}
      <Sheet open={open} onClose={onClose} title={t('Background terminals')}>
        <View style={{ padding: space.l, gap: space.s }}>
          <T size={font.caption} tone="muted">
            {store.computers.find((host) => host.id === hostId)?.name ?? hostId} · {chat.title}
          </T>
          {!online && <T tone="muted">{t('Offline · last-known activity')}</T>}
          {status === 'loading' && <ActivityIndicator accessibilityLabel={t('Loading background commands…')} />}
          {status === 'unsupported' && (
            <T tone="muted">{t('Update Ramu on this host to manage background commands.')}</T>
          )}
          {status === 'error' && (
            <T tone="bad">{t((selected ? detail.error : list.error) ?? 'Could not load background commands.')}</T>
          )}
          {actionError && <T tone="bad">{t(actionError)}</T>}
          <Button kind="ghost" title={t('Refresh')} disabled={!online || status === 'loading'} onPress={retry} />
          {selected ? (
            <>
              <Button kind="ghost" title={t('All commands')} onPress={() => setSelection(null)} />
              {shown && (
                <>
                  <T mono copyable={shown.command} numberOfLines={3}>
                    {shown.command}
                  </T>
                  <T mono size={font.caption} tone="muted" numberOfLines={2} copyable={shown.cwd}>
                    {shown.cwd}
                  </T>
                  <T size={font.caption} tone="muted">
                    {stateLabel(shown)} ·{' '}
                    {new Date(shown.startedAt).toLocaleString(store.language === 'id' ? 'id-ID' : 'en-US')}
                    {shown.exitCode !== null ? ` · ${t('Exit code {0}', { 0: shown.exitCode })}` : ''}
                  </T>
                  {shown.state === 'unknown' && (
                    <T tone="muted">{t('Command status cannot be verified. Saved output is available.')}</T>
                  )}
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
              {status === 'ready' && !rows.length && (
                <T tone="muted">{t('No tracked background commands in this thread.')}</T>
              )}
              {rows.map((command) => (
                <Row
                  key={command.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${command.command} · ${stateLabel(command)}`}
                  onPress={() => setSelection({ scope, id: command.id })}
                >
                  <View style={{ flex: 1, gap: space.xs }}>
                    <T mono numberOfLines={2}>
                      {command.command}
                    </T>
                    <T size={font.caption} tone="muted">
                      {stateLabel(command)}
                    </T>
                  </View>
                </Row>
              ))}
            </>
          )}
        </View>
      </Sheet>
    </>
  )
}
