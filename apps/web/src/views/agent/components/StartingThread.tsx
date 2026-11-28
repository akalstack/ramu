import { useState } from 'react'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import type { Attachment } from '@ramu/shared/types'
import { AgentControls } from '../../../chat/AgentControls'
import { ChatStatus } from '../../../chat/ChatMotion'
import { Composer } from '../../../composer/Composer'
import { ComposerStack } from '../../../composer/ComposerStack'
import { t as translate, useLanguage } from '../../../i18n'
import type { StartingThread } from '../../../workspace/startingThreads'
import { nextTurnDate } from '../lib/derive'
import { COMPOSER_DOCK_CLASS, LIVE_ITEM_CLASS, TRANSCRIPT_COLUMN_CLASS, TRANSCRIPT_VIEWPORT_CLASS } from '../styles'
import { StartingAgentHeader } from './AgentHeader'
import { SentMessage } from './PendingSubmission'
import { TurnDate } from './TranscriptTurn'

/**
 * A new thread's first message before the host has it, laid out as the turn it becomes (day label included), so it
 * stays put from the send through the thread opening to the host's copy replacing it.
 */
export function OpeningTurn({
  text,
  attachments,
  sentAt,
  now,
  start = false,
}: {
  text: string
  attachments: Attachment[]
  sentAt: number
  now: number
  /** Begins the sent message's rise; the copies that take its place later carry it on. */
  start?: boolean
}) {
  const date = nextTurnDate([], sentAt)
  return (
    <div className="turn flex flex-col gap-3.5 min-w-0">
      {date !== undefined && <TurnDate at={date} now={now} />}
      <SentMessage text={text} attachments={attachments} start={start} />
    </div>
  )
}

/** The conversation of a thread still being started, drawn in the thread view's own transcript frame. */
export function StartingTranscript({ thread, start = false }: { thread: StartingThread; start?: boolean }) {
  useLanguage()
  const [now] = useState(Date.now)
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <div className="transcript-frame relative flex-1 min-h-0 min-w-0 flex [container:transcript-frame_/_inline-size] flex-col">
        <MessageScroller className="transcript min-h-0 min-w-0 flex-1">
          <MessageScrollerViewport
            aria-label={translate('Conversation')}
            className={`${TRANSCRIPT_VIEWPORT_CLASS} pt-3 pb-7`}
          >
            <MessageScrollerContent className={`${TRANSCRIPT_COLUMN_CLASS} gap-3.5`}>
              <MessageScrollerItem messageId="opening" className={LIVE_ITEM_CLASS}>
                <OpeningTurn
                  text={thread.text}
                  attachments={thread.attachments}
                  sentAt={thread.sentAt}
                  now={now}
                  start={start}
                />
              </MessageScrollerItem>
              <ChatStatus label={thread.status} enter={start} />
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </div>
    </MessageScrollerProvider>
  )
}

/**
 * A thread Home just created, while setup and the agent start: the thread view's header, transcript and message box,
 * each where the thread will draw it, so opening the thread changes nothing on screen.
 */
export function StartingThreadView({ thread }: { thread: StartingThread }) {
  useLanguage()
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <StartingAgentHeader />
      <StartingTranscript thread={thread} />
      <div className={COMPOSER_DOCK_CLASS}>
        <ComposerStack>
          <Composer
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            disabled
            controls={<AgentControls settings={thread.settings} onChange={() => {}} disabled />}
            placeholder={translate('Reply to the agent')}
            submitLabel="Send"
          />
        </ComposerStack>
      </div>
    </div>
  )
}
