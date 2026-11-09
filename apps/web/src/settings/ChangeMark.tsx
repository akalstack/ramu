import { useContext } from 'react'
import { InlineAction, LocalInlineAction } from '@/components/inline-action'
import { t, useLanguage } from '../i18n'
import { SettingsDefaultsContext, SettingsThreadContext } from './settingsField'
import type { SettingsScope } from './SettingsScope'

/**
 * A changed-row dot. It names the thread whose agent changed this setting, linking to that thread when it is on this
 * computer, and stays until the person changes the row again; a row that differs from its default also offers Reset.
 */
export function ChangeMark({ path, scope }: { path: string; scope: SettingsScope }) {
  useLanguage()
  const threads = useContext(SettingsThreadContext)
  const defaults = useContext(SettingsDefaultsContext)
  const mark = scope.agentMark(path)
  const changed = defaults?.changed(path) ? defaults : null
  if (!mark && !changed) return null
  const text = mark && t('Changed by an agent in {0}', { '0': mark.thread })
  const here = !!mark && !!threads && scope.primaryId === scope.currentId && threads.has(mark.taskId)
  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle text-caption font-normal text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-brand" />
      {mark &&
        (here ? (
          <LocalInlineAction tone="muted" onClick={() => threads.open(mark.taskId)}>
            {text}
          </LocalInlineAction>
        ) : (
          <span>{text}</span>
        ))}
      {changed && (
        <InlineAction
          tone="muted"
          aria-label={t('Put back the default')}
          title={t('Put back the default')}
          disabled={scope.field(path).disabled}
          onClick={() => changed.reset(path)}
        >
          {t('Reset')}
        </InlineAction>
      )}
    </span>
  )
}
