import { buildInbox, type InboxReview } from '@ramu/shared/hostInbox'
import { hostInboxInput } from '@ramu/shared/hostOverview'
import { useComputers } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'
import { useFailureSeen } from './failureSeen'
import { lastVisit } from './lastVisit'

/** The Inbox model across every connected host, so Home, the Inbox and the badge all give the same answer. */
export function useInboxModel({ everyHost = false, reviews }: { everyHost?: boolean; reviews?: InboxReview[] } = {}) {
  const computers = useComputers()
  const failureSeen = useFailureSeen()
  const hosts = useHostOverviews(computers?.computers.map((computer) => computer.id) ?? [])
  const visit = lastVisit()
  const model = buildInbox({
    ...hostInboxInput(hosts),
    computerId: everyHost ? null : (computers?.scope ?? null),
    failureSeen,
    ...(reviews ? { reviews } : {}),
  })
  return { model, hosts, computers, visit }
}
