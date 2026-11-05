import type { ReasoningEffort, SubagentPreferences } from '@ramu/shared/types'
import { SettingsRow, SettingsTitle } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { effortDisplayName, modelDisplayName, useModelSets } from '../models/ModelSets'

const efforts: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export function SubagentSelectionSettings({
  value,
  onChange,
  busy,
}: {
  value: SubagentPreferences
  onChange: (patch: Partial<SubagentPreferences>) => void
  busy: boolean
}) {
  useLanguage()
  const { catalogs } = useModelSets()
  const capOptions = [
    { value: '', label: t('No cap') },
    ...efforts.map((effort) => ({ value: effort, label: effortDisplayName(effort, 'codex') })),
  ]
  return (
    <>
      <SettingsRow setting="subagents.autoSelect">
        <span>
          <SettingsTitle>{t('Automatic selection')}</SettingsTitle>
          <span className="muted text-muted-foreground block small text-caption">
            {t(
              'For cross-provider tasks, ask the destination provider to choose. Adds a short selection request; unavailable selection uses the configured model and effort.',
            )}
          </span>
        </span>
        <Dropdown
          label={t('Automatic selection')}
          value={value.autoSelect ?? 'off'}
          disabled={busy}
          options={[
            { value: 'off', label: t('Off (default)') },
            { value: 'model-and-effort', label: t('Model and effort') },
            { value: 'effort-only', label: t('Effort only') },
          ]}
          onChange={(autoSelect) => onChange({ autoSelect: autoSelect as SubagentPreferences['autoSelect'] })}
        />
      </SettingsRow>
      <SettingsRow setting="subagents.maxEffort">
        <span>
          <SettingsTitle>{t('Maximum sub-agent effort')}</SettingsTitle>
          <span className="muted text-muted-foreground block small text-caption">
            {t(
              'Caps Ramu-managed sub-agents, including fallbacks. Native sub-agents keep their provider settings. The lower of the global and model caps applies.',
            )}
          </span>
        </span>
        <Dropdown
          label={t('Maximum sub-agent effort')}
          value={value.maxEffort ?? ''}
          disabled={busy}
          options={capOptions}
          onChange={(effort) => onChange({ maxEffort: effort ? (effort as ReasoningEffort) : null })}
        />
      </SettingsRow>
      <SettingsRow setting="subagents.modelMaxEffort" className="settings-stack">
        <SettingsTitle>{t('Per-model effort caps')}</SettingsTitle>
        <details>
          <summary>{t('Configure model caps')}</summary>
          {catalogs
            .flatMap((catalog) => catalog.models)
            .filter((model) => model.efforts.length)
            .map((model) => {
              const key = `${model.provider}:${model.id}`
              return (
                <div key={key} className="flex items-center justify-between gap-4 py-2">
                  <span>
                    {modelDisplayName(model.name)} · {model.provider}
                  </span>
                  <Dropdown
                    label={t('Maximum effort for {0}', { '0': model.name })}
                    value={value.modelMaxEffort?.[key] ?? ''}
                    disabled={busy}
                    options={[
                      { value: '', label: t('No model cap') },
                      ...model.efforts.map((effort) => ({
                        value: effort,
                        label: effortDisplayName(effort, model.provider),
                      })),
                    ]}
                    onChange={(effort) => {
                      const caps = { ...value.modelMaxEffort }
                      if (effort) caps[key] = effort as ReasoningEffort
                      else delete caps[key]
                      onChange({ modelMaxEffort: caps })
                    }}
                  />
                </div>
              )
            })}
        </details>
      </SettingsRow>
    </>
  )
}
