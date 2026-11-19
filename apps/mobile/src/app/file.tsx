import { useLocalSearchParams } from 'expo-router'
import { FileViewer } from '../components/FileViewer'
export default function ScopedFile() {
  const { computer, ctx, repoId, path, line, composerProject, draftContext } = useLocalSearchParams<{
    computer: string
    ctx: string
    repoId: string
    path: string
    line?: string
    composerProject?: string
    draftContext?: string
  }>()
  return (
    <FileViewer
      key={JSON.stringify([computer, ctx, repoId, path])}
      computerId={computer}
      contextId={ctx}
      repoId={repoId}
      path={path}
      line={line}
      composer={composerProject ? { projectId: composerProject, draftContext } : undefined}
    />
  )
}
