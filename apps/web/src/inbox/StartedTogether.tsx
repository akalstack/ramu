import { useMemo } from 'react'
import { groupSummary, startedGroups, type GroupMemberState } from '@ramu/shared/workspace/startedGroups'
import { FadeText } from '../FadeText'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { useComputers } from '../workspace/computers'
import { useHostSelection } from '../workspace/HostSelection'
import { useWorkspacesOf } from '../workspace/workspace'

const STATE_LABEL: Record<GroupMemberState, string> = {
  running: 'Working',
  waiting: 'Waiting for your input',
  failed: 'Failed',
  finished: 'Finished',
  stopped: 'Stopped',
}

/** Threads one prompt started together, across connected hosts, each a click away. */
export function StartedTogether() {
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
  const projectName = (hostId: string, projectId: string) =>
    stores[hosts.findIndex((computer) => computer.id === hostId)]?.projects.find((project) => project.id === projectId)
      ?.name ?? t('No project')
  return (
    <FeedSection title={t('Started together')} count={groups.length}>
      {groups.map((group) => {
        const summary = groupSummary(group)
        return (
          <div key={group.groupId} className="flex flex-col gap-1">
            <p className="m-0 text-caption text-muted-foreground" role="status">
              {t(summary.text, summary.values)}
            </p>
            {/* The same row as other agent lists, so a group reads like the threads around it. */}
            <div className="@container -mx-2.5 flex flex-col gap-px">
              {group.members.map((member) => {
                const open = () => select(member.hostId, { kind: 'task', taskId: member.task.id })
                const where = [
                  projectName(member.hostId, member.task.projectId),
                  hosts.length > 1 ? hostName(member.hostId) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <article key={`${member.hostId}:${member.task.id}`} className="agent-row">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={member.task.title}
                      onClick={open}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && event.key === 'Enter') open()
                      }}
                      className="flex min-h-9 cursor-default items-center gap-2 rounded-(--radius-s) px-2.5 text-body leading-5 text-soft [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] hover:bg-accent hover:text-foreground"
                    >
                      <FadeText
                        className="min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap"
                        text={member.task.title}
                      />
                      <span className="max-w-[35%] min-w-0 truncate text-caption text-muted-foreground" title={where}>
                        {where}
                      </span>
                      <span
                        className={`flex-none text-caption ${member.state === 'waiting' ? 'text-warn' : member.state === 'failed' ? 'text-bad' : 'text-muted-foreground'}`}
                      >
                        {t(STATE_LABEL[member.state])}
                      </span>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )
      })}
    </FeedSection>
  )
}
