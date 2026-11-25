import { buildInbox, type InboxReview } from '@ramu/shared/hostInbox'
import { hostInboxInput } from '@ramu/shared/hostOverview'
import { useAppSettings } from '../settings/AppSettings'
import { useComputers } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'
import { useFailureSeen } from './failureSeen'

/** The Inbox model across every connected host, so Home, the Inbox and the badge all give the same answer. */
export function useInboxModel({ everyHost = false, reviews }: { everyHost?: boolean; reviews?: InboxReview[] } = {}) {
  const computers = useComputers()
  const { preferences } = useAppSettings()
  const failureSeen = useFailureSeen()
  const hosts = useHostOverviews(computers?.computers.map((computer) => computer.id) ?? [])
  const visit = Number(localStorage.getItem('ramu.last-visit') ?? 0)
  const model = buildInbox({
    ...hostInboxInput(hosts),
    computerId: everyHost ? null : (computers?.scope ?? null),
    // The preference read here is this window's host; other hosts' overviews already reflect their own.
    recapsEnabled: (id) => id !== computers?.current || preferences.recapsEnabled,
    failureSeen,
    visit,
    ...(reviews ? { reviews } : {}),
  })
  return { model, hosts, computers, visit }
}
