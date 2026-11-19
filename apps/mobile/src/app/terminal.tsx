import { goBackOrHome } from '../runtime/navigation'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { TerminalScreen } from '../components/TerminalScreen'

/** A terminal outside any chat: a project's folders, a worktree, or a project-less chat's folder. */
export default function WorkspaceTerminal() {
  const { computer, ctx } = useLocalSearchParams<{ computer: string; ctx: string }>()
  const router = useRouter()
  return <TerminalScreen computerId={computer} ctx={ctx} onBack={() => goBackOrHome(router)} />
}
