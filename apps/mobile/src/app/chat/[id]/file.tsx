import { useLocalSearchParams } from 'expo-router'
import { useChat } from '../../../runtime/store'
import { readRevision } from '../../../runtime/gitRevision'
import { FileViewer } from '../../../components/FileViewer'
/** A thread's file, opened from the transcript or Source Control. */
export default function ThreadFile() {
  const { id, repoId, path, line, mode, oid, stash } = useLocalSearchParams<{
    id: string
    repoId: string
    path: string
    line?: string
    mode?: 'file' | 'changes' | 'staged' | 'all'
    oid?: string
    stash?: string
  }>()
  const chat = useChat(id)
  return (
    <FileViewer
      key={JSON.stringify([id, repoId, path, oid, stash])}
      computerId={chat?.computerId}
      contextId={chat?.taskId}
      repoId={repoId}
      path={path}
      line={line}
      initial={mode}
      revision={readRevision(oid, stash)}
    />
  )
}
