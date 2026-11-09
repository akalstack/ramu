import { useContext } from 'react'
import { LocalInlineAction } from '@/components/inline-action'
import { t, useLanguage } from '../i18n'
import { SettingsThreadContext } from './settingsField'
import type { SettingsScope } from './SettingsScope'

/**
 * A changed-row dot naming the thread whose agent changed this setting, linking to that thread when it is on this
 * computer. It stays until the person changes the row again.
 */
export function AgentChangeMark({ path, scope }: { path: string; scope: SettingsScope }) {
  useLanguage()
  const threads = useContext(SettingsThreadContext)
  const mark = scope.agentMark(path)
  if (!mark) return null
  const text = t('Changed by an agent in {0}', { '0': mark.thread })
  const here = !!threads && scope.primaryId === scope.currentId && threads.has(mark.taskId)
  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle text-caption font-normal text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-brand" />
      {here ? (
        <LocalInlineAction tone="muted" onClick={() => threads.open(mark.taskId)}>
          {text}
        </LocalInlineAction>
      ) : (
        <span>{text}</span>
      )}
    </span>
  )
}
