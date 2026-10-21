import { useEffect, useState } from 'react'
import {
  CUSTOM_SEARCH,
  SEARCH_CUSTOM_KEY,
  SEARCH_ENGINE_KEY,
  SEARCH_ENGINES,
  searchTemplateFrom,
  validSearchTemplate,
} from '@ramu/shared/browserLinks'
import { Input } from '@/components/desktop-input'
import { deviceStorage } from '../deviceStorage'
import { t, useLanguage } from '../i18n'
import { Dropdown } from '../Menu'

const read = () => ({
  engine: deviceStorage.getItem(SEARCH_ENGINE_KEY) ?? SEARCH_ENGINES[0].id,
  custom: deviceStorage.getItem(SEARCH_CUSTOM_KEY) ?? '',
})

/** The search the address box uses for typed words; a choice of this device, shared by every thread's browser. */
export function useSearchEngine() {
  const [state, setState] = useState(read)
  useEffect(
    () =>
      deviceStorage.subscribe((key) => {
        if (key === SEARCH_ENGINE_KEY || key === SEARCH_CUSTOM_KEY) setState(read())
      }),
    [],
  )
  return { ...state, template: searchTemplateFrom(state.engine, state.custom) }
}

export function SearchEnginePicker({ label }: { label: string }) {
  useLanguage()
  const { engine, custom } = useSearchEngine()
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-2">
      <Dropdown
        label={label}
        value={engine}
        options={[
          ...SEARCH_ENGINES.map((entry) => ({ value: entry.id, label: entry.name })),
          { value: CUSTOM_SEARCH, label: t('Custom address') },
        ]}
        onChange={(value) => deviceStorage.setItem(SEARCH_ENGINE_KEY, value)}
      />
      {engine === CUSTOM_SEARCH && (
        <>
          <Input
            aria-label={t('Custom search address')}
            aria-invalid={!!custom && !validSearchTemplate(custom)}
            placeholder="https://example.com/search?q=%s"
            defaultValue={custom}
            onChange={(event) => deviceStorage.setItem(SEARCH_CUSTOM_KEY, event.target.value.trim())}
          />
          <span className="text-caption text-muted-foreground">
            {validSearchTemplate(custom)
              ? t('Searches use this address.')
              : t('Use a web address with %s where the search words go. DuckDuckGo is used until then.')}
          </span>
        </>
      )}
    </div>
  )
}
