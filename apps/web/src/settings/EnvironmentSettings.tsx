import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { Check, ClipboardCopy, Eye, EyeOff, Globe, Plus, RefreshCw, X } from 'lucide-react'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AGENT_PROVIDERS, providerEnabled, providerName } from '@ramu/shared/providers/providers'
import {
  environmentProblem,
  formatDotEnv,
  parseDotEnv,
  pasteDotEnv,
  sameEnvironment,
  type EnvironmentScope,
  type EnvironmentVariable,
  type ProviderEnvironmentStatus,
  type ProviderEnvironmentValues,
} from '@ramu/shared/providers/environment'
import type { AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { ProviderIcon } from '../models/ProviderIcon'
import { useScopedInvoke, type SettingsScope } from './SettingsScope'
import { GHOST_ICON_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, SETTINGS_FORM_CLASS } from './constants'

/** Owned by the settings panel so the shared Save button, unsaved-change guard and reload cover these values too. */
export function useProviderEnvironment(scope: SettingsScope, active: boolean) {
  const invoke = useScopedInvoke(scope)
  const readOnly = scope.targets?.some((target) => target.viewOnly) ?? false
  const key = scope.loadKey
  const access = useRef({ key, readOnly })
  access.current = { key, readOnly }
  const current = () => access.current.key === key && !access.current.readOnly
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const sequence = useRef(0)
  const [status, setStatus] = useState<ProviderEnvironmentStatus | null>(null)
  const [draft, setDraft] = useState<ProviderEnvironmentValues>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async (retry = false) => {
    if (!current()) return
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await invoke('providers.environment', retry)
      if (!current() || request !== sequence.current) return
      setLoadedKey(key)
      setStatus(next)
      setDraft(next.values ?? {})
    } catch (reason) {
      if (current() && request === sequence.current) setError(errorText(reason))
    } finally {
      if (access.current.key === key && request === sequence.current) setLoading(false)
    }
  }
  // Fetched when the page is first shown for a host; returning to the page keeps unsaved edits.
  const loaded = useRef<string | null>(null)
  useEffect(() => {
    ++sequence.current
    setLoadedKey(null)
    setStatus(null)
    setDraft({})
    loaded.current = null
  }, [scope.loadKey])
  useEffect(() => {
    if (!readOnly) return
    ++sequence.current
    setLoading(false)
    if (loadedKey !== key) loaded.current = null
  }, [readOnly, loadedKey, key])
  useEffect(() => {
    if (!active || readOnly || scope.loading || loaded.current === scope.loadKey) return
    loaded.current = scope.loadKey
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [active, scope.loadKey, scope.loading, invoke, readOnly])
  const changed = loadedKey === key && !!status?.values && !sameEnvironment(draft, status.values)
  const save = async () => {
    if (access.current.key !== key)
      throw new Error(t('The selected host changed. Reload environment variables before saving.'))
    if (!current()) throw new Error(t(VIEW_ONLY_WRITE_NOTICE))
    if (loadedKey !== key) throw new Error(t('Reload environment variables before saving.'))
    const next = await invoke('providers.setEnvironment', draft)
    if (!current()) return
    setStatus(next)
    setDraft(next.values ?? {})
  }
  const updateDraft: typeof setDraft = (next) => {
    if (current() && loadedKey === key) setDraft(next)
  }
  return {
    status: loadedKey === key ? status : null,
    draft: loadedKey === key ? draft : {},
    setDraft: updateDraft,
    changed,
    save,
    load,
    loading,
    error,
    readOnly,
  }
}
export type ProviderEnvironment = ReturnType<typeof useProviderEnvironment>

const blank = (): EnvironmentVariable => ({ key: '', value: '' })
/** Always one empty row at the end, so adding a variable is just typing. */
const withBlank = (rows: EnvironmentVariable[]) =>
  rows.length && !rows.at(-1)!.key && !rows.at(-1)!.value ? rows : [...rows, blank()]
const scopeName = (scope: EnvironmentScope) => (scope === 'global' ? t('All providers') : providerName(scope))

export function EnvironmentSettings({
  environment,
  preferences,
  busy,
}: {
  environment: ProviderEnvironment
  preferences: AppPreferences
  busy: boolean
}) {
  const { status, draft, setDraft, load, loading, error } = environment
  const [scope, setScope] = useState<EnvironmentScope>('global')
  const [reveal, setReveal] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const focus = useRef<{ row: number; field: 'key' | 'value' } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const editable = !environment.readOnly && !!status?.canAdminister && status.state !== 'unavailable'
  // Turned-off providers stay listed while they still have variables, so nothing saved is hidden.
  const scopes: EnvironmentScope[] = [
    'global',
    ...AGENT_PROVIDERS.filter(
      (provider) => providerEnabled(preferences.providerBinaries, provider) || (draft[provider] ?? []).length,
    ),
  ]
  const count = (item: EnvironmentScope) =>
    (status?.values ? (draft[item] ?? []) : (status?.keys[item] ?? []).map((key) => ({ key }))).filter((v) => v.key)
      .length
  const rows = withBlank(draft[scope] ?? [])
  const set = (next: EnvironmentVariable[]) => setDraft({ ...draft, [scope]: next.filter((v) => v.key || v.value) })
  const edit = (index: number, patch: Partial<EnvironmentVariable>) =>
    set(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const paste = (index: number, field: 'key' | 'value') => (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text')
    // A single-line value may itself contain `=` (base64, URLs); only a name field or several lines mean `.env`.
    if (field === 'value' && !/\n/.test(pasted.trim())) return
    const next = pasteDotEnv(rows, index, pasted)
    if (!next) return
    event.preventDefault()
    set(next)
  }
  useEffect(() => {
    const target = focus.current
    if (!target) return
    focus.current = null
    list.current?.querySelector<HTMLInputElement>(`[data-row="${target.row}"][data-field="${target.field}"]`)?.focus()
  })
  useEffect(() => setText(null), [scope, status])
  const commitText = () => {
    if (text !== null) set(parseDotEnv(text))
  }
  const copy = async () => {
    await navigator.clipboard.writeText(formatDotEnv(rows) + '\n')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const inherited = scope === 'global' ? [] : (draft.global ?? []).filter((v) => v.key)
  const own = new Set(rows.map((row) => row.key))

  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Environment variables')}</SettingsGroupTitle>
      {environment.readOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <p className="muted text-muted-foreground small text-caption">
        {t(
          'Added to the agent processes Ramu starts on this host, over your shell environment. Values are kept in the host’s credential store. New threads use changes; running threads keep theirs.',
        )}
      </p>
      {error && (
        <p className="error text-bad small text-caption" role="alert">
          {error}
        </p>
      )}
      {status?.state === 'unavailable' && (
        <div className="flex items-center gap-3 mb-3" role="alert">
          <p className="error text-bad small text-caption m-0!">
            {t('Saved variables could not be read. Unlock the credential store on this host, then try again.')}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={environment.readOnly || loading}
            onClick={() => void load(true)}
          >
            <RefreshCw size={13} className={loading ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} />
            {t('Try again')}
          </Button>
        </div>
      )}
      {status && !status.canAdminister && (
        <p className="muted text-muted-foreground small text-caption">
          {t('Values can only be viewed and changed on the host running Ramu. Names are shown here.')}
        </p>
      )}
      <ToggleGroup
        size="sm"
        variant="outline"
        spacing={2}
        className="flex-wrap gap-1.5 mb-3"
        aria-label={t('Applies to')}
        value={[scope]}
        onValueChange={(values) => values[0] && setScope(values[0] as EnvironmentScope)}
      >
        {scopes.map((item) => (
          <ToggleGroupItem key={item} value={item} className="gap-1.5 px-2.5">
            {item === 'global' ? <Globe size={13} /> : <ProviderIcon provider={item} size={13} />}
            {scopeName(item)}
            {count(item) > 0 && <span className="text-muted-foreground tabular-nums">{count(item)}</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="muted text-muted-foreground small text-caption m-[0_0_10px]!">
        {scope === 'global'
          ? t('Used by every provider. A provider’s own variable with the same name wins.')
          : t('Used only by {0}, for every account. Wins over a variable with the same name in All providers.', {
              0: providerName(scope),
            })}
      </p>
      {editable ? (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <ToggleGroup
              size="sm"
              variant="outline"
              spacing={2}
              className="gap-1.5"
              aria-label={t('Editor')}
              value={[text === null ? 'table' : 'text']}
              onValueChange={(values) => {
                if (values[0] === 'text' && text === null) setText(formatDotEnv(rows))
                if (values[0] === 'table' && text !== null) {
                  commitText()
                  setText(null)
                }
              }}
            >
              <ToggleGroupItem value="table" className="px-2.5">
                {t('Variables')}
              </ToggleGroupItem>
              <ToggleGroupItem value="text" className="px-2.5">
                {t('.env text')}
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="grow" />
            {text === null && (
              <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)} aria-pressed={reveal}>
                {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                {reveal ? t('Hide values') : t('Show values')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className={SECONDARY_BUTTON_CLASS}
              disabled={!rows.some((row) => row.key)}
              onClick={() => void copy().catch(() => {})}
            >
              {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
              {copied ? t('Copied') : t('Copy as .env')}
            </Button>
          </div>
          {text !== null ? (
            <Textarea
              aria-label={t('{0} variables as .env text', { 0: scopeName(scope) })}
              className="font-mono text-caption min-h-[220px] bg-field"
              spellCheck={false}
              placeholder={'ANTHROPIC_BASE_URL=https://example.com\nHTTPS_PROXY=http://proxy:8080'}
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              onBlur={commitText}
            />
          ) : (
            <div
              ref={list}
              className="grid gap-1.5"
              role="list"
              aria-label={t('{0} variables', { 0: scopeName(scope) })}
            >
              {rows.map((row, index) => {
                const problem = row.key || row.value ? environmentProblem(row, rows) : null
                const last = index === rows.length - 1
                return (
                  <div key={index} role="listitem" className="grid gap-1">
                    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5 items-center">
                      <Input
                        data-row={index}
                        data-field="key"
                        aria-label={t('Name')}
                        aria-invalid={!!problem || undefined}
                        className="font-mono"
                        placeholder={last ? t('NAME — or paste a .env file') : t('NAME')}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoComplete="off"
                        maxLength={128}
                        value={row.key}
                        disabled={busy}
                        onChange={(event) => edit(index, { key: event.target.value.trim() })}
                        onPaste={paste(index, 'key')}
                      />
                      <Input
                        data-row={index}
                        data-field="value"
                        aria-label={t('Value of {0}', { 0: row.key || t('new variable') })}
                        className="font-mono"
                        type={reveal ? 'text' : 'password'}
                        placeholder={t('value')}
                        spellCheck={false}
                        autoComplete="off"
                        value={row.value}
                        disabled={busy}
                        onChange={(event) => edit(index, { value: event.target.value })}
                        onPaste={paste(index, 'value')}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={GHOST_ICON_BUTTON_CLASS}
                        aria-label={t('Remove {0}', { 0: row.key || t('new variable') })}
                        disabled={busy || last}
                        onClick={() => {
                          focus.current = { row: Math.max(0, index - 1), field: 'key' }
                          set(rows.filter((_, i) => i !== index))
                        }}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                    {problem && (
                      <p className="error text-bad small text-caption m-0!" role="alert">
                        {t(problem)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {text === null && (
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  focus.current = { row: rows.length - 1, field: 'key' }
                  set(rows)
                }}
              >
                <Plus size={13} />
                {t('Add variable')}
              </Button>
              <span className="muted text-muted-foreground small text-caption">
                {t('Tip: paste a whole .env file into a name field to fill every row.')}
              </span>
            </div>
          )}
        </>
      ) : (
        status && (
          <ul className="grid gap-1 m-0 p-0 list-none" aria-label={t('{0} variables', { 0: scopeName(scope) })}>
            {(status.keys[scope] ?? []).map((key) => (
              <li key={key}>
                <code className="text-caption">{key}</code>
              </li>
            ))}
            {!(status.keys[scope] ?? []).length && (
              <li className="muted text-muted-foreground small text-caption">{t('No variables.')}</li>
            )}
          </ul>
        )
      )}
      {inherited.length > 0 && (
        <p className="muted text-muted-foreground small text-caption mt-3!">
          {t('Also receives from All providers: {0}', {
            0: inherited.map((v) => (own.has(v.key) ? `${v.key} (${t('replaced')})` : v.key)).join(', '),
          })}
        </p>
      )}
    </div>
  )
}
