import { Check } from 'lucide-react'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { ProviderIcon } from '../models/ProviderIcon'
import type { AgentProvider, Project } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { cn } from 'cn'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'

/** Where a plugin, skill or server is used: `''` for every project, else a project id or another place's value. */
export interface UseChoice {
  providers: AgentProvider[]
  place: string
}

export const EVERY_USE: UseChoice = { providers: [...AGENT_PROVIDERS], place: '' }

/**
 * Which agents use a plugin, skill or MCP server and in which projects, chosen the same way when it is installed and
 * changed the same way after. Every agent and every project is the default, since most tools help everywhere and a
 * narrower choice is easy to make here later.
 */
export function UseFor({
  value,
  onChange,
  projects,
  places = [],
  disabled,
  placeLocked,
}: {
  value: UseChoice
  onChange: (value: UseChoice) => void
  projects: Project[]
  /** Other places it can be used besides all projects and each project, such as an identity's projects. */
  places?: { value: string; label: string }[]
  disabled?: boolean
  /** Why the projects cannot be changed here, such as a plugin's skill following its plugin. */
  placeLocked?: string
}) {
  useLanguage()
  const every = value.providers.length === AGENT_PROVIDERS.length
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2.5 rounded-(--radius-s) border-0 bg-fill px-3 py-2.5"
      disabled={disabled}
    >
      <legend className="sr-only">{t('Who uses it')}</legend>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-control text-foreground">{t('Agents')}</span>
          <span className="text-caption text-muted-foreground">
            {every ? t('Every agent') : t('{0} of {1}', { 0: value.providers.length, 1: AGENT_PROVIDERS.length })}
          </span>
        </span>
        <div role="group" aria-label={t('Agents')} className="flex flex-wrap gap-1.5">
          {AGENT_PROVIDERS.map((provider) => {
            const on = value.providers.includes(provider)
            return (
              <Button
                key={provider}
                size="sm"
                variant="ghost"
                aria-pressed={on}
                disabled={disabled || (on && value.providers.length === 1)}
                title={on && value.providers.length === 1 ? t('At least one agent uses it') : undefined}
                className={cn(
                  'h-7 rounded-full border border-line px-2.5 text-caption',
                  on ? 'bg-background text-foreground' : 'text-muted-foreground',
                )}
                onClick={() =>
                  onChange({
                    ...value,
                    providers: on
                      ? value.providers.filter((entry) => entry !== provider)
                      : AGENT_PROVIDERS.filter((entry) => entry === provider || value.providers.includes(entry)),
                  })
                }
              >
                {on && <Check size={12} aria-hidden />}
                <ProviderIcon provider={provider} size={12} className={on ? '' : 'opacity-50'} />
                {providerName(provider)}
              </Button>
            )
          })}
        </div>
      </div>
      {placeLocked ? (
        <p className="m-0 text-caption text-muted-foreground">{placeLocked}</p>
      ) : (
        (projects.length > 0 || places.length > 0) && (
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="text-control text-foreground">{t('Projects')}</span>
            <Dropdown
              label={t('Projects')}
              value={value.place}
              disabled={disabled}
              className="max-w-[60%] min-w-40 !bg-background"
              options={[
                { value: '', label: t('All projects') },
                ...places,
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              onChange={(place) => onChange({ ...value, place })}
            />
          </div>
        )
      )}
    </fieldset>
  )
}
