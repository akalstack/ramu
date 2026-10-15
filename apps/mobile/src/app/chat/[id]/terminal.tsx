import { useLocalSearchParams, useRouter } from 'expo-router'
import { useChat } from '../../../runtime/store'
import { TerminalScreen, terminalCtx } from '../../../components/TerminalScreen'
import { Header, Screen } from '../../../components/Screen'

/** The terminal for a chat's workspace; its sessions are shared with every chat in the same project or worktree. */
export default function ChatTerminal() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const router = useRouter()
  if (!chat?.taskId) return <Screen><Header title="Chat not found" /></Screen>
  return <TerminalScreen computerId={chat.computerId} ctx={terminalCtx(chat)} onBack={() => router.dismissTo({ pathname: '/chat/[id]', params: { id } })} />
}
