import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { providerName } from '@ramu/shared/providers/providers'
import type { ModelNotice } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useAppSettings } from '../settings/AppSettings'
import { notifyError } from '../chat/Notifications'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'

const OPEN_EVENT = 'ramu:new-models'

/** Shows the models a "new models" notice was about. */
export const showNewModels = (list: ModelNotice[]) =>
  window.dispatchEvent(new CustomEvent<ModelNotice[]>(OPEN_EVENT, { detail: list }))

const contextText = (tokens: number) =>
  tokens >= 1_000_000
    ? t('{0}M context', { '0': +(tokens / 1_000_000).toFixed(1) })
    : t('{0}K context', { '0': Math.round(tokens / 1000) })

/**
 * The new models themselves, from the notice that announced them: provider, context and release date as the host's
 * catalog has them, and a star that pins one to the top of the model picker, where it is chosen for a thread.
 */
export function NewModelsDialog() {
  const language = useLanguage()
  const [list, setList] = useState<ModelNotice[] | null>(null)
  const { catalogs } = useModelSets()
  const app = useAppSettings()
  const [favorites, setFavorites] = useState<string[] | null>(null)
  useEffect(() => {
    const open = (event: Event) => {
      setFavorites(null)
      setList((event as CustomEvent<ModelNotice[]>).detail)
    }
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])
  if (!list) return null
  const current = favorites ?? app.preferences.favoriteModels ?? []
  const toggle = (key: string) => {
    const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    setFavorites(next)
    void app.save({ ...app.preferences, favoriteModels: next }).catch((reason) => {
      setFavorites(null)
      notifyError(errorText(reason), 'Models')
    })
  }
  const date = new Intl.DateTimeFormat(language === 'id' ? 'id-ID' : undefined, { dateStyle: 'medium' })
  return (
    <Dialog
      title={list.length === 1 ? t('New model') : t('{0} new models', { '0': list.length })}
      confirmLabel={t('Done')}
      cancellable={false}
      onCancel={() => setList(null)}
      onConfirm={() => setList(null)}
    >
      <p className="text-caption text-muted-foreground">
        {t('Star one to keep it at the top of the model picker, where you choose it for a thread.')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {list.map((notice) => {
          const key = `${notice.provider}:${notice.model}`
          const model = catalogs
            .find((catalog) => catalog.provider === notice.provider)
            ?.models.find((entry) => entry.id === notice.model)
          const starred = current.includes(key)
          const name = modelDisplayName(model?.name ?? notice.name)
          const details = [
            providerName(notice.provider),
            model?.contextWindow ? contextText(model.contextWindow) : null,
            model?.releasedAt ? t('Released {0}', { '0': date.format(new Date(model.releasedAt)) }) : null,
          ].filter(Boolean)
          return (
            <li key={key} className="flex min-h-11 items-center gap-2.5 rounded-(--radius-s) px-1.5 hover:bg-hover">
              <ProviderIcon provider={notice.provider} size={18} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-control font-medium text-foreground">{name}</span>
                <span className="truncate text-caption text-muted-foreground">{details.join(' · ')}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={starred}
                aria-label={
                  starred ? t('Remove {0} from favorites', { '0': name }) : t('Add {0} to favorites', { '0': name })
                }
                className={starred ? 'text-(--warn)' : 'text-muted-foreground'}
                onClick={() => toggle(key)}
              >
                <Star size={15} fill={starred ? 'currentColor' : 'none'} />
              </Button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
