import { useLocalSearchParams, useRouter } from 'expo-router'
import { ListSplit } from '../components/SplitPane'
import { PullRequestList } from '../components/PullRequestList'
import PullRequestScreen from './chat/[id]/pull-request'

/**
 * A pull request opened from the Pull requests page: the same screen a thread opens, keyed by host and project. On a
 * wide window it sits beside that list, and another pull request picked there replaces it in place.
 */
export default function PullRequestRoute() {
  const router = useRouter()
  const { url } = useLocalSearchParams<{ url: string }>()
  return (
    <ListSplit pane={() => <PullRequestList pane={{ openUrl: url, open: (target) => router.setParams(target) }} />}>
      <PullRequestScreen key={url} />
    </ListSplit>
  )
}
