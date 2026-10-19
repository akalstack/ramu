import { useLocalSearchParams } from 'expo-router'
import { useChat } from '../../../runtime/store'
import { FileViewer } from '../../../components/FileViewer'
/** Compatibility route for existing transcript and Source Control links. */
export default function ThreadFile() {
  const { id, repoId, path, line, mode } = useLocalSearchParams<{
    id: string
    repoId: string
    path: string
    line?: string
    mode?: 'file' | 'changes' | 'staged' | 'all'
  }>()
  const chat = useChat(id)
  return (
    <FileViewer
      key={JSON.stringify([id, repoId, path])}
      computerId={chat?.computerId}
      contextId={chat?.taskId}
      repoId={repoId}
      path={path}
      line={line}
      initial={mode}
    />
  )
}
