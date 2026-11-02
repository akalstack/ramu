import { useMemo, useState } from 'react'
import type { AgentModel, AgentProvider } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { providerName } from '@ramu/shared/providers/providers'
import { t } from '../i18n'
import { modelDisplayName } from '../models/ModelSets'
import { SearchInput } from '../SearchInput'
import { usePaged } from './cards'

/**
 * Which of a provider's models appear in pickers and dropdowns, for providers that report more than anyone wants to
 * scroll. Starts from everything listed; clearing the list down to a few keeps new models out until they are added.
 */
export function ProviderModels({
  provider,
  models,
  listed,
  disabled,
  onChange,
}: {
  provider: AgentProvider
  models: AgentModel[]
  /** Absent means every model is listed. */
  listed: string[] | undefined
  disabled?: boolean
  onChange(listed: string[] | undefined): void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const known = useMemo(() => new Set(models.map((model) => model.id)), [models])
  const count = listed ? listed.filter((id) => known.has(id)).length : models.length
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    return models.filter(
      (model) =>
        !text || model.id.toLowerCase().includes(text) || modelDisplayName(model.name).toLowerCase().includes(text),
    )
  }, [models, query])
  const paged = usePaged(matches, 60, query)
  if (!models.length) return null
  const toggle = (id: string, on: boolean) => {
    const current = listed ?? models.map((model) => model.id)
    const next = on ? [...current, id] : current.filter((entry) => entry !== id)
    onChange(models.every((model) => next.includes(model.id)) ? undefined : next)
  }
  return (
    <>
      <SettingsRow className="mb-0">
        <SettingsLabel
          title={t('Models')}
          help={t('{0} of {1} listed in model pickers', { 0: count, 1: models.length })}
        />
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
          {t('Choose models')}
        </Button>
      </SettingsRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100vh-48px)] flex-col">
          <DialogHeader>
            <DialogTitle>{t('{0} models', { 0: providerName(provider) })}</DialogTitle>
            <DialogDescription>
              {t(
                'Only checked models appear in model pickers. New models stay out until you add them, and a model already in use keeps working.',
              )}
            </DialogDescription>
          </DialogHeader>
          <SearchInput
            aria-label={t('Search models')}
            placeholder={t('Search models…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          <div className="flex items-center gap-2">
            <span className="flex-1 text-caption text-muted-foreground" role="status">
              {t('{0} of {1} listed in model pickers', { 0: count, 1: models.length })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              {t('Select all')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              {t('Clear')}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {paged.shown.map((model) => (
              <label
                key={model.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-(--radius-s) p-[6px_8px] hover:bg-hover"
              >
                <Checkbox
                  checked={!listed || listed.includes(model.id)}
                  onCheckedChange={(on) => toggle(model.id, on === true)}
                />
                <span className="min-w-0 flex-1 truncate text-control">{modelDisplayName(model.name)}</span>
                {model.name !== model.id && (
                  <span className="min-w-0 max-w-[45%] truncate text-caption text-muted-foreground">{model.id}</span>
                )}
              </label>
            ))}
            {!matches.length && (
              <p className="m-0 p-3 text-center text-caption text-muted-foreground">{t('No matching models')}</p>
            )}
            {paged.more}
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setOpen(false)}>
              {t('Done')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
