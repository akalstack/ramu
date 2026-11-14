import { useLocalSearchParams, useRouter } from 'expo-router'
import { useChat } from '../../../runtime/store'
import { TerminalScreen, terminalCtx } from '../../../components/TerminalScreen'
import { Header, Screen } from '../../../components/Screen'
import { useSay } from '../../../i18n'

/** The terminal for a chat's workspace; its sessions are shared with every chat in the same project or worktree. */
export default function ChatTerminal() {
  const say = useSay()
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>()
  const chat = useChat(id)
  const router = useRouter()
  if (!chat?.taskId)
    return (
      <Screen>
        <Header title={say('Thread not found')} />
      </Screen>
    )
  return (
    <TerminalScreen
      computerId={chat.computerId}
      ctx={terminalCtx(chat)}
      {...(focus ? { focus } : {})}
      onBack={() => router.dismissTo({ pathname: '/chat/[id]', params: { id } })}
    />
  )
}
