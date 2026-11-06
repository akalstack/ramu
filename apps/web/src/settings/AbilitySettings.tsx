import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  ABILITIES,
  ABILITY_LABELS,
  DEFAULT_ABILITY_PREFERENCES,
  type Ability,
  type AbilityCheck,
  type AbilityChoice,
  type AbilityPreferences,
} from '@ramu/shared/providers/abilities'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import type { AppPreferences } from '@ramu/shared/types'
import { SettingsGroupTitle, SettingsRow, SettingsTitle } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { modelDisplayName, useModelSets } from '../models/ModelSets'
import { useSettingsInvoke } from './SettingsScope'

const choiceValue = (choice: AbilityChoice | undefined) =>
  !choice || choice === 'auto' ? 'auto' : choice === 'off' ? 'off' : `${choice.provider}:${choice.model}`

/** Settings › Models › Abilities: which provider runs each ability for threads whose own provider lacks it. */
export function AbilitySettings({
  value,
  onChange,
  busy,
}: {
  value: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
}) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const { catalogs } = useModelSets()
  const [checks, setChecks] = useState<AbilityCheck[] | null>(null)
  const [running, setRunning] = useState(false)
  const abilities: AbilityPreferences = { ...DEFAULT_ABILITY_PREFERENCES, ...value.abilities }
  useEffect(() => {
    let active = true
    const load = () =>
      void invoke('abilities.checks').then(
        (status) => {
          if (!active) return
          setChecks(status.checks)
          setRunning(status.running)
        },
        () => active && setChecks([]),
      )
    load()
    // Checks finish in the background; read again while they run.
    const timer = window.setInterval(load, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [invoke])
  const set = (ability: Ability, choice: AbilityChoice) =>
    onChange({ ...value, abilities: { ...abilities, choices: { ...abilities.choices, [ability]: choice } } })
  const modelName = (provider: AbilityCheck['provider'], id: string) =>
    modelDisplayName(
      catalogs.find((catalog) => catalog.provider === provider)?.models.find((model) => model.id === id)?.name ?? id,
    )
  return (
    <div className="settings-form flex flex-col gap-0 mt-8">
      <SettingsGroupTitle>{t('Abilities')}</SettingsGroupTitle>
      <p className="muted text-muted-foreground small text-caption m-[0_0_12px] leading-[1.55]">
        {t(
          "When a thread's provider cannot do something, such as making an image, its agent asks Ramu, which runs just that step on one of your signed-in providers that can. Only what the agent passes is sent.",
        )}
        {running ? ` ${t('Checking providers…')}` : ''}
      </p>
      {ABILITIES.map((ability) => {
        const passed = (checks ?? []).filter((check) => check.ability === ability && check.ok)
        const choice = abilities.choices[ability]
        const current = choiceValue(choice)
        const options = [
          { value: 'auto', label: t('Auto') },
          ...passed.map((check) => ({
            value: `${check.provider}:${check.model}`,
            label: `${modelName(check.provider, check.model)} · ${providerName(check.provider)}`,
          })),
          { value: 'off', label: t('Off') },
        ]
        if (typeof choice === 'object' && !options.some((option) => option.value === current))
          options.splice(1, 0, {
            value: current,
            label: `${modelName(choice.provider, choice.model)} · ${providerName(choice.provider)}`,
          })
        return (
          <SettingsRow key={ability}>
            <span>
              <SettingsTitle>{t(ABILITY_LABELS[ability])}</SettingsTitle>
              <span className="muted text-muted-foreground block small text-caption">
                {checks === null
                  ? t('Loading…')
                  : passed.length
                    ? t('Checked on {0}', {
                        '0': [...new Set(passed.map((check) => providerName(check.provider)))].join(', '),
                      })
                    : t('No signed-in provider here offers it.')}
              </span>
            </span>
            <Dropdown
              label={t(ABILITY_LABELS[ability])}
              value={current}
              disabled={busy}
              keepOptions
              options={options}
              onChange={(next) => {
                if (next === 'auto' || next === 'off') return set(ability, next)
                const [provider, ...model] = next.split(':')
                const check = passed.find((entry) => entry.provider === provider)
                if (check) set(ability, { provider: check.provider, model: model.join(':') })
              }}
            />
          </SettingsRow>
        )
      })}
      <SettingsRow setting="abilities.askBeforeOtherProvider" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Ask before using another provider')}</SettingsTitle>
          <span className="muted text-muted-foreground block small text-caption">
            {t(
              'Each call that would run on a provider other than the thread’s waits for your approval, which names the provider and what is sent.',
            )}
          </span>
        </span>
        <Switch
          aria-label={t('Ask before using another provider')}
          checked={abilities.askBeforeOtherProvider}
          disabled={busy}
          onCheckedChange={(checked) =>
            onChange({ ...value, abilities: { ...abilities, askBeforeOtherProvider: checked } })
          }
        />
      </SettingsRow>
    </div>
  )
}

/** A provider card's ability checks: what passed on this installed version, and a way to check again. */
export function ProviderAbilities({ status, onChecked }: { status: ProviderStatus; onChecked: () => void }) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const recheck = useCallback(() => {
    setChecking(true)
    setError('')
    void invoke('abilities.check', status.provider)
      .then(onChecked, (reason) => setError(errorText(reason)))
      .finally(() => setChecking(false))
  }, [invoke, onChecked, status.provider])
  const checks = status.abilities ?? []
  if (!checks.length) return null
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-6">
        <span className="min-w-0">
          <strong className="font-medium">{t('Abilities')}</strong>
          <span className="mt-1 block max-w-[420px] small text-caption leading-[18px] muted text-muted-foreground">
            {t('Checked with one small request on version {0}.', { '0': checks[0]!.version })}
          </span>
        </span>
        <Button size="sm" variant="ghost" disabled={checking} onClick={recheck}>
          {checking ? t('Checking…') : t('Check again')}
        </Button>
      </div>
      <ul className="m-0 grid gap-0.5 p-0 list-none small text-caption">
        {checks.map((check) => (
          <li key={check.ability} className="flex items-start gap-1.5">
            {check.ok ? (
              <Check size={13} className="mt-0.5 flex-none text-ok" aria-hidden />
            ) : (
              <X size={13} className="mt-0.5 flex-none text-muted-foreground" aria-hidden />
            )}
            <span className={check.ok ? '' : 'muted text-muted-foreground'}>
              {t(ABILITY_LABELS[check.ability])}
              {check.ok ? ` · ${t('Available')}` : ` · ${t('Not available')}${check.detail ? `: ${check.detail}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error m-0 text-bad small text-caption" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
