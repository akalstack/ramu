import { useState } from 'react'
import { Layers, Monitor, TriangleAlert } from 'lucide-react'
import { sameValue, type SettingSchema } from '@ramu/shared/settingsCompatibility'
import { Button } from '@/components/desktop-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import type { SettingHost, SettingsScope } from './SettingsScope'

/** A value as a person reads it, from its type alone: On, Off, a choice's words, a count, or Custom. */
function readable(value: unknown, schema: SettingSchema): string {
  if (value === null || value === undefined) return t('Not set')
  if (typeof value === 'boolean') return value ? t('On') : t('Off')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (!value) return t('Empty')
    if (!schema.enum) return value
    const words = value.replace(/[-_]+/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  if (Array.isArray(value)) return t(value.length === 1 ? '1 item' : '{0} items', { 0: value.length })
  if (typeof value === 'object' && typeof (value as { model?: unknown }).model === 'string')
    return (value as { model: string }).model
  return t('Custom')
}

const valueKey = (host: SettingHost) => (host.state === 'ready' || host.state === 'locked' ? host.value : undefined)

/**
 * Where one setting stands on each selected host, beside its title: a quiet icon that opens every host's value, whether
 * it is the default, and why a host cannot take it. Mixed values and hosts that do not know the setting say so in the
 * row itself, so nothing about them is hidden behind the icon.
 */
export function SettingHosts({
  path,
  scope,
  inline = false,
}: {
  path: string
  scope: SettingsScope
  /** Right after the setting's title, on its line, instead of on a line of its own. */
  inline?: boolean
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (!scope.ready) return null
  const hosts = scope.hosts(path)
  if (!hosts.length) return null
  const state = scope.field(path)
  const known = hosts.filter((host) => host.state === 'ready' || host.state === 'locked')
  const unknown = hosts.filter((host) => host.state === 'unknown')
  const mixed = state.mixed
  const primary = hosts.find((host) => host.id === scope.primaryId)
  const restart = async () => {
    setRestarting(true)
    setProblem(null)
    try {
      // Resolves once the restarted service answers, with the settings its build knows.
      await ramu.invoke('background.restartService', 'keep')
      scope.reload()
    } catch (reason) {
      setProblem(errorText(reason))
      setRestarting(false)
      return
    }
    setRestarting(false)
    setOpen(false)
  }
  const status = unknown.length
    ? t('Not on {0}', { 0: unknown.map((host) => host.name).join(', ') })
    : scope.readOnlyHosts.length
      ? null
      : mixed
        ? t('Mixed')
        : null
  return (
    <span
      className={`items-center gap-1.5 text-caption font-normal ${inline ? 'ml-1.5 inline-flex align-middle' : 'mt-1 flex'}`}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('This setting on each host')}
              title={t('This setting on each host')}
              className={`${inline ? '' : '-ml-1'} size-5 min-h-0 p-0 text-muted-foreground transition-opacity ${
                status ? 'opacity-100' : 'opacity-0 [.settings-row:hover_&]:opacity-100 focus-visible:opacity-100'
              } ${unknown.length ? 'text-warn' : mixed ? 'text-brand' : ''}`}
            />
          }
        >
          {unknown.length ? <TriangleAlert size={12} /> : <Layers size={12} />}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[min(340px,calc(100vw-16px))] gap-2 p-3">
          <p className="m-0 text-caption font-medium text-muted-foreground">{t('On each host')}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {hosts.map((host) => {
              // With mixed values, the hosts that differ from the one Settings shows are the ones to look at.
              const differs = !!primary && mixed && !sameValue(valueKey(host), valueKey(primary))
              return (
                <li key={host.id} className="flex items-start gap-2 rounded-(--radius-s) px-1.5 py-1 text-control">
                  <Monitor size={13} className="mt-[3px] flex-none text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {host.name}
                      {host.current && <span className="text-muted-foreground"> · {t('this computer')}</span>}
                    </span>
                    {host.state === 'unknown' && (
                      <span className="block text-caption text-warn">
                        {host.current
                          ? t('Its background service runs an older Ramu. Restart it to change this here.')
                          : t('This host runs an older Ramu. Update it to change this there.')}
                      </span>
                    )}
                    {host.state === 'unreachable' && (
                      <span className="block text-caption text-muted-foreground">
                        {host.reason ?? t('This host is offline.')}
                      </span>
                    )}
                    {host.state === 'locked' && (
                      <span className="block text-caption text-muted-foreground">{t('Read only from here')}</span>
                    )}
                  </span>
                  {(host.state === 'ready' || host.state === 'locked') && (
                    <span className="flex flex-none flex-col items-end">
                      <span className={differs ? 'text-brand' : 'text-foreground'}>
                        {readable(host.value, host.schema)}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {host.isDefault ? t('Default') : t('Changed')}
                      </span>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {problem && (
            <p role="alert" className="m-0 text-caption text-bad">
              {problem}
            </p>
          )}
          {(mixed || unknown.some((host) => host.current)) && (
            <div className="flex flex-wrap justify-end gap-1 border-t border-(--line) pt-2">
              {unknown.some((host) => host.current) && (
                <Button size="sm" variant="secondary" disabled={restarting} onClick={() => void restart()}>
                  {t('Restart service')}
                </Button>
              )}
              {mixed && primary && known.length > 1 && !state.disabled && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    scope.mark(path)
                    setOpen(false)
                  }}
                >
                  {t('Use {0}’s value on every host', { 0: primary.name })}
                </Button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {status && <span className={unknown.length ? 'text-warn' : 'text-muted-foreground'}>{status}</span>}
    </span>
  )
}
