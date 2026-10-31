import { useMemo } from 'react'
import { groupSummary, startedGroups, type GroupMemberState } from '@ramu/shared/workspace/startedGroups'
import { Button } from '@/components/desktop-button'
import { FeedSection } from './HomeSection'
import { t, useLanguage } from './i18n'
import { useComputers } from './workspace/computers'
import { useHostSelection } from './workspace/HostSelection'
import { useWorkspacesOf } from './workspace/workspace'

const STATE_LABEL: Record<GroupMemberState, string> = {
  running: 'Working',
  waiting: 'Waiting for your input',
  failed: 'Failed',
  finished: 'Finished',
  stopped: 'Stopped',
}

/** Threads one Home prompt started together, across connected hosts, each a click away. */
export function HomeGroups() {
  useLanguage()
  const computers = useComputers()
  const { select } = useHostSelection()
  const hosts = useMemo(
    () => (computers?.computers ?? []).filter((computer) => computer.status === 'connected'),
    [computers],
  )
  const stores = useWorkspacesOf(hosts.map((computer) => computer.id))
  const groups = useMemo(
    () =>
      startedGroups(hosts.map((computer, index) => ({ hostId: computer.id, tasks: stores[index]?.tasks ?? [] }))).slice(
        0,
        3,
      ),
    [hosts, stores],
  )
  if (!groups.length) return null
  const hostName = (id: string) => hosts.find((computer) => computer.id === id)?.name ?? ''
  return (
    <FeedSection title={t('Started together')} count={groups.length}>
      {groups.map((group) => (
        <div key={group.groupId} className="flex flex-col gap-1 rounded-(--radius-m) bg-fill p-3">
          <p className="m-0 text-caption text-muted-foreground" role="status">
            {t(groupSummary(group).text, groupSummary(group).values)}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.members.map((member) => (
              <li key={`${member.hostId}:${member.task.id}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => select(member.hostId, { kind: 'task', taskId: member.task.id })}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{member.task.title}</span>
                  {hosts.length > 1 && (
                    <span className="flex-none text-caption text-muted-foreground">{hostName(member.hostId)}</span>
                  )}
                  <span
                    className={`flex-none text-caption ${member.state === 'waiting' ? 'text-warn' : member.state === 'failed' ? 'text-bad' : 'text-muted-foreground'}`}
                  >
                    {t(STATE_LABEL[member.state])}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </FeedSection>
  )
}
