import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  ABILITIES,
  ABILITY_LABELS,
  DEFAULT_ABILITY_PREFERENCES,
  ASKED_MCP_ABILITIES,
  AUTO_MCP_ABILITIES,
  MCP_ABILITIES,
  isMcpChoice,
  isMediaChoice,
  mediaFor,
  type Ability,
  type AbilityCheck,
  type AbilityChoice,
  type AbilityMcpCheck,
  type AbilityMcpTool,
  type AbilityMcpToolOption,
  type AbilityPreferences,
} from '@ramu/shared/providers/abilities'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import type { AppPreferences } from '@ramu/shared/types'
import { MEDIA_SERVICE_NAMES, MEDIA_SERVICES, type MediaService } from '@ramu/shared/types/media'
import { SettingsGroupTitle, SettingsRow, SettingsTitle } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from '../Menu'
import { formatLocale, t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { modelDisplayName, useModelSets } from '../models/ModelSets'
import { useSettingsInvoke } from './SettingsScope'

const mcpValue = (tool: AbilityMcpTool) => `mcp:${tool.connectionId}:${tool.tool}`
const mediaValue = (service: MediaService) => `media:${service}`
const choiceValue = (choice: AbilityChoice | undefined) =>
  !choice || choice === 'auto'
    ? 'auto'
    : choice === 'off'
      ? 'off'
      : isMcpChoice(choice)
        ? mcpValue(choice)
        : isMediaChoice(choice)
          ? mediaValue(choice.media)
          : `${choice.provider}:${choice.model}`

/** Settings › Models › Abilities: which provider runs each ability for threads whose own provider lacks it. */
export function AbilitySettings({
  value,
  onChange,
  busy,
  onOpenMedia,
}: {
  value: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
  /** Opens the Media keys in Settings › Providers, where the media services' keys are saved. */
  onOpenMedia: () => void
}) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const { catalogs } = useModelSets()
  const [checks, setChecks] = useState<AbilityCheck[] | null>(null)
  const [mcpChecks, setMcpChecks] = useState<AbilityMcpCheck[]>([])
  const [media, setMedia] = useState<MediaService[]>([])
  const [running, setRunning] = useState(false)
  // Approved Shared MCP tools an image or search ability can run on instead of a provider.
  const [mcpTools, setMcpTools] = useState<AbilityMcpToolOption[]>([])
  useEffect(() => {
    void invoke('abilities.mcpTools').then(setMcpTools, () => setMcpTools([]))
  }, [invoke])
  const abilities: AbilityPreferences = { ...DEFAULT_ABILITY_PREFERENCES, ...value.abilities }
  useEffect(() => {
    let active = true
    const load = () =>
      void invoke('abilities.checks').then(
        (status) => {
          if (!active) return
          setChecks(status.checks)
          setMcpChecks(status.mcpChecks)
          setMedia(status.media)
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
  const setAutoMcp = (ability: Ability, tool: AbilityMcpTool | undefined) =>
    onChange({ ...value, abilities: { ...abilities, autoMcp: { ...abilities.autoMcp, [ability]: tool } } })
  /** What Auto's Shared MCP tool for an ability is: unchecked until a thread first needs it, then its result. */
  const autoMcpText = (ability: Ability, tool: AbilityMcpTool) => {
    const check = mcpChecks.find(
      (entry) => entry.ability === ability && entry.connectionId === tool.connectionId && entry.tool === tool.tool,
    )
    if (!check) return t('Checked through the first thread that needs it, before Auto uses it.')
    if (!check.ok) return `${t('Not available')}${check.detail ? `: ${check.detail}` : ''}`
    return check.score === undefined
      ? t('Available')
      : `${t('Available')} · ${t('{0}% on the sample tasks', { '0': String(Math.round(check.score * 100)) })}`
  }
  const modelName = (provider: AbilityCheck['provider'], id: string) =>
    modelDisplayName(
      catalogs.find((catalog) => catalog.provider === provider)?.models.find((model) => model.id === id)?.name ?? id,
    )
  return (
    <div className="settings-form flex flex-col gap-0 mt-8">
      <SettingsGroupTitle>{t('Abilities')}</SettingsGroupTitle>
      <p className="muted text-muted-foreground small text-caption m-[0_0_12px] leading-[1.55]">
        {t(
          "When a thread's provider cannot do something, like make an image, its agent asks Ramu to run that one step on another signed-in provider that can. Only what the agent passes is sent.",
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
          ...mediaFor(ability, media).map((service) => ({
            value: mediaValue(service),
            label: `${MEDIA_SERVICE_NAMES[service]} · ${t('API key')}`,
          })),
          ...(MCP_ABILITIES.includes(ability)
            ? mcpTools.map((tool) => ({ value: mcpValue(tool), label: `${tool.tool} · ${tool.server}` }))
            : []),
          { value: 'off', label: t('Off') },
        ]
        const offered = mediaFor(ability, media)
        if (typeof choice === 'object' && !options.some((option) => option.value === current))
          options.splice(1, 0, {
            value: current,
            label: isMcpChoice(choice)
              ? `${choice.tool} · ${t('Shared MCP')}`
              : isMediaChoice(choice)
                ? `${MEDIA_SERVICE_NAMES[choice.media]} · ${t('No key saved')}`
                : `${modelName(choice.provider, choice.model)} · ${providerName(choice.provider)}`,
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
                    : offered.length
                      ? t('On your {0} API key', {
                          '0': offered.map((service) => MEDIA_SERVICE_NAMES[service]).join(', '),
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
                const tool = mcpTools.find((entry) => mcpValue(entry) === next)
                if (tool) return set(ability, { connectionId: tool.connectionId, tool: tool.tool })
                const service = MEDIA_SERVICES.find((entry) => mediaValue(entry) === next)
                if (service) return set(ability, { media: service })
                const [provider, ...model] = next.split(':')
                const check = passed.find((entry) => entry.provider === provider)
                if (check) set(ability, { provider: check.provider, model: model.join(':') })
              }}
            />
          </SettingsRow>
        )
      })}
      {[...AUTO_MCP_ABILITIES, ...ASKED_MCP_ABILITIES]
        .filter((ability) => mcpTools.length && (abilities.choices[ability] ?? 'auto') === 'auto')
        .map((ability) => {
          const tool = abilities.autoMcp?.[ability]
          return (
            <SettingsRow key={`auto-mcp-${ability}`}>
              <span>
                <SettingsTitle>{t('{0}: also try in Auto', { '0': t(ABILITY_LABELS[ability]) })}</SettingsTitle>
                <span className="muted text-muted-foreground block small text-caption">
                  {ASKED_MCP_ABILITIES.includes(ability) || tool?.status
                    ? t('Each call spends the service’s credits, so the first one in a thread asks you.')
                    : tool
                      ? autoMcpText(ability, tool)
                      : t('A Shared MCP tool Auto tries after your signed-in providers.')}
                </span>
              </span>
              <Dropdown
                label={t('{0}: also try in Auto', { '0': t(ABILITY_LABELS[ability]) })}
                value={tool ? mcpValue(tool) : 'none'}
                disabled={busy}
                keepOptions
                options={[
                  { value: 'none', label: t('None') },
                  ...mcpTools.map((entry) => ({ value: mcpValue(entry), label: `${entry.tool} · ${entry.server}` })),
                ]}
                onChange={(next) => {
                  const picked = mcpTools.find((entry) => mcpValue(entry) === next)
                  // A plugin's mapping keeps its status tool and download origins when the same tool is picked again.
                  setAutoMcp(
                    ability,
                    picked
                      ? tool?.connectionId === picked.connectionId && tool.tool === picked.tool
                        ? tool
                        : { connectionId: picked.connectionId, tool: picked.tool }
                      : undefined,
                  )
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
              'Calls to a provider other than the thread’s wait for your approval, which shows the provider and what is sent.',
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
      <SettingsRow>
        <span>
          <SettingsTitle>{t('Media')}</SettingsTitle>
          <span className="muted text-muted-foreground block small text-caption">
            {media.length
              ? t('Video, speech, music and sound effects can also run on your {0} API key.', {
                  '0': media.map((service) => MEDIA_SERVICE_NAMES[service]).join(', '),
                })
              : t('Save an API key for Google Gemini or ElevenLabs to make video, speech, music or sound effects.')}
          </span>
        </span>
        <Button variant="secondary" size="sm" onClick={onOpenMedia}>
          {media.length ? t('Manage keys') : t('Add a key')}
        </Button>
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
              {check.ok && check.score !== undefined
                ? ` · ${t('{0}% on the sample tasks', { '0': String(Math.round(check.score * 100)) })}`
                : ''}
              {check.ok
                ? ` · ${
                    !check.apiKey
                      ? t('Subscription')
                      : check.typicalCostUsd === undefined
                        ? t('API key, cost not reported')
                        : t('About {0} a call', {
                            '0': new Intl.NumberFormat(formatLocale(), {
                              style: 'currency',
                              currency: 'USD',
                              maximumFractionDigits: 3,
                            }).format(check.typicalCostUsd),
                          })
                  }`
                : ''}
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
