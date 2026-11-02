import { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { CircleCheck } from 'lucide-react-native'
import {
  blockerTally,
  blockerTallyLine,
  BRIEF_ROWS,
  briefRows,
  finishedSince,
  TALLY_MIN_THREADS,
  type BriefRow,
  type InboxModel,
} from '@ramu/shared/hostInbox'
import { retryThread } from '@ramu/shared/operator'
import { useSay } from '../i18n'
import { useAutomation } from '../runtime/automation'
import { inboxBlockerText } from '../runtime/inboxBlockerText'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { Group, Nothing } from './InboxParts'
import { InputRequests } from './InputRequests'
import { Button, T } from './ui'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

function BriefRowView({ row, divider, where }: { row: BriefRow; divider: boolean; where: (chat: Chat) => string }) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const auto = useAutomation()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const hostId = row.kind === 'recap' ? row.recap.computerId : row.chat.computerId
  const taskId = row.kind === 'recap' ? row.recap.item.taskId : row.chat.taskId
  const chat = store.chats.find((entry) => entry.computerId === hostId && entry.taskId === taskId)
  const computer = store.computers.find((entry) => entry.id === hostId)
  const viewOnly = computer?.access === 'viewer'
  const online = computer?.status === 'online'
  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    void work()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }
  const go = () => {
    if (chat) router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
  }
  const invoke = store.invoke as unknown as Invoke
  const request =
    row.kind === 'blocker' && (row.blocker.kind === 'approval' || row.blocker.kind === 'question')
      ? row.chat.inputSummary?.requests[0]
      : undefined
  const off = busy || !online
  const title = row.kind === 'recap' ? row.recap.item.title : (chat?.title ?? '')
  const detail =
    row.kind === 'recap'
      ? row.recap.item.detail
      : row.kind === 'failure'
        ? say('Failed')
        : request?.title || inboxBlockerText(row.blocker, store.language === 'id' ? 'id' : 'en')
  return (
    <View
      style={{
        padding: space.m,
        gap: space.s,
        borderTopWidth: divider ? 0.5 : 0,
        borderTopColor: c.line,
      }}
    >
      <View>
        <T weight="500" numberOfLines={1}>
          {title}
        </T>
        <T size={font.caption} tone={row.kind === 'failure' ? 'bad' : 'muted'} numberOfLines={2}>
          {[detail, chat ? where(chat) : ''].filter(Boolean).join(' · ')}
        </T>
      </View>
      {error ? (
        <T size={font.caption} tone="bad">
          {error}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {viewOnly ? null : row.kind === 'failure' ? (
          <>
            <Button
              title={say('Retry')}
              disabled={off}
              onPress={() => run(() => retryThread(invoke, { hostId, taskId }))}
            />
            <Button
              kind="secondary"
              title={say('Mark done')}
              disabled={off}
              onPress={() => run(() => invoke(hostId, 'tasks.done', taskId, true).then(() => store.refresh(hostId)))}
            />
          </>
        ) : row.kind === 'recap' ? (
          <Button
            kind="secondary"
            title={say('Mark done')}
            disabled={off}
            onPress={() => run(() => auto.actRecap(hostId, row.recap.item, 'done'))}
          />
        ) : request?.kind === 'approval' ? (
          <Button
            title={say('Allow once')}
            disabled={off}
            onPress={() =>
              run(() =>
                invoke(hostId, 'agent.replyPermission', request.sessionId, request.requestId, true, undefined, 'once'),
              )
            }
          />
        ) : request?.choices ? (
          request.choices.options.map((option) => (
            <Button
              key={option}
              kind="secondary"
              title={option}
              disabled={off}
              onPress={() =>
                run(() =>
                  invoke(hostId, 'agent.replyQuestion', request.sessionId, request.requestId, {
                    [request.choices!.key]: option,
                  }),
                )
              }
            />
          ))
        ) : request ? (
          <Button
            kind="secondary"
            title={open ? say('Hide') : say('Answer')}
            disabled={!online}
            onPress={() => setOpen((value) => !value)}
          />
        ) : null}
        <Button kind="ghost" title={say('Open')} disabled={!chat} onPress={go} />
      </View>
      {open && chat ? <InputRequests chat={chat} /> : null}
    </View>
  )
}

/** Inbox's first tab: what needs the person now, most urgent first, across every host, with the usual step one tap away. */
export function InboxBrief({ inbox, where }: { inbox: InboxModel; where: (chat: Chat) => string }) {
  const say = useSay()
  const auto = useAutomation()
  const [all, setAll] = useState(false)
  const rows = briefRows(inbox)
  const shown = all ? rows : rows.slice(0, BRIEF_ROWS)
  const finished = finishedSince(inbox, auto.visit)
  if (!rows.length)
    return (
      <Nothing
        icon={CircleCheck}
        title={say('Nothing needs you')}
        detail={
          finished
            ? say('{0} finished since your last visit.', { 0: finished })
            : say('Questions, approvals, failures and recaps that need a decision show up here.')
        }
      />
    )
  return (
    <View style={{ gap: space.s }}>
      <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.l }}>
        {[say('{0} need you', { 0: rows.length }), finished ? say('{0} finished', { 0: finished }) : '']
          .filter(Boolean)
          .join(' · ')}
      </T>
      {inbox.waiting.length >= TALLY_MIN_THREADS ? (
        <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.l }}>
          {blockerTallyLine(blockerTally(inbox.waiting), say)}
        </T>
      ) : null}
      <Group>
        {shown.map((row, index) => (
          <BriefRowView
            key={JSON.stringify([
              row.kind,
              row.kind === 'recap' ? row.recap.computerId : row.chat.computerId,
              row.kind === 'recap' ? row.recap.item.id : row.chat.taskId,
            ])}
            row={row}
            divider={index > 0}
            where={where}
          />
        ))}
      </Group>
      {rows.length > shown.length ? (
        <Button
          kind="ghost"
          title={`${say('See all')} · ${rows.length}`}
          onPress={() => setAll(true)}
          style={{ alignSelf: 'flex-start', marginHorizontal: space.l }}
        />
      ) : null}
    </View>
  )
}
