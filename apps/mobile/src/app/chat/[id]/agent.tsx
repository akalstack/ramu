import { useLocalSearchParams } from 'expo-router'
import { translate } from '@ramu/shared/i18n'
import { helperStatusLabel } from '@ramu/shared/chat/helperPresentation'
import { space } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { Header, PageScrollView as ScrollView, Screen } from '../../../components/Screen'
import { HelperBody } from '../../../components/Helpers'
import { T } from '../../../components/ui'
import type { Chat } from '../../../runtime/types'

/** The newest report of one helper among the thread's agent cards, so the screen follows it as it works. */
function helperOf(chat: Chat, agentId: string) {
  for (let index = chat.items.length - 1; index >= 0; index--) {
    const item = chat.items[index]!
    if (item.kind !== 'agents') continue
    const task = item.agents.find((entry) => (entry.agentId ?? entry.id) === agentId)
    if (task) return { ...task, agentId }
  }
  return undefined
}

/**
 * One sub-agent on a screen of its own, as the desktop opens it beside the thread: how it is doing, its task, output,
 * changes and report, with a message box and Stop. Back returns to the thread where it was started.
 */
export default function AgentScreen() {
  const { id, agent } = useLocalSearchParams<{ id: string; agent: string }>()
  const chat = useChat(id)
  const { language } = useStore()
  const task = chat && agent ? helperOf(chat, agent) : undefined
  return (
    <Screen>
      <Header
        title={task?.name ?? translate(language, 'Agent')}
        subtitle={task ? translate(language, helperStatusLabel(task)) : chat?.title}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: space.xl }}
      >
        {chat && task ? (
          <HelperBody task={task} chat={chat} />
        ) : (
          <T tone="muted" style={{ padding: space.l }}>
            {translate(language, 'This agent is no longer in the thread.')}
          </T>
        )}
      </ScrollView>
    </Screen>
  )
}
