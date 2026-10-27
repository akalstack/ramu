import { BottomSearch } from './BottomSearch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, TextInput, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers/providers'
import { RULE_BODY_LIMIT, RULE_NAME_LIMIT, type Rule, type RuleInput, type RuleRevision } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Row, Segmented, Sheet, T } from './ui'
import { ToggleRow } from './SettingRows'
import { matchesWords, searchWords } from '@ramu/shared/listView'

/** Uses the host rule collection; editing text never grants agent permissions or starts work. */
export function RulesSettings({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string) => translate(store.language, key)
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<{ rule: Rule | null } | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(30)
  const sequence = useRef(0)
  const online = store.isOnline(hostId)
  const owner = store.computers.find((computer) => computer.id === hostId)?.access !== 'viewer'
  const runtime = useRef(store)
  runtime.current = store
  const read = useCallback(async () => {
    const version = ++sequence.current
    if (!hostId || !runtime.current.isOnline(hostId)) return
    setLoading(true)
    setError('')
    try {
      const result = await runtime.current.invoke(hostId, 'rules.list')
      if (sequence.current === version) setRules(result)
    } catch (reason) {
      if (sequence.current === version) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(/unknown method/i.test(message) ? t('Update this host to manage rules.') : message)
      }
    } finally {
      if (sequence.current === version) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [hostId] by design; the values it reads beyond these are current as of that run
  }, [hostId])
  useEffect(() => {
    void read()
    const unsubscribe = hostId
      ? store.subscribe(hostId, (channel) => {
          if (channel === 'rules:changed') void read()
        })
      : () => {}
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++sequence.current
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [read, online] by design; the values it reads beyond these are current as of that run
  }, [read, online])
  const words = searchWords(query)
  const matches = rules.filter((rule) => matchesWords(`${rule.name} ${rule.body}`, words))
  return (
    <View style={{ padding: space.l, gap: space.m }}>
      <T tone="muted">
        {t('Instructions for how agents work, sent at the start of a thread. They never grant permissions.')}
      </T>
      {!online ? <T tone="muted">{t('Reconnect to use these controls.')}</T> : null}
      {error ? <T tone="bad">{error}</T> : null}
      {loading ? <ActivityIndicator color={c.accent} /> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button
          title={t('New rule')}
          disabled={!online || !owner || loading || !!error}
          onPress={() => setEditor({ rule: null })}
        />
        <Button title={t('Refresh')} kind="ghost" disabled={!online || loading} onPress={() => void read()} />
      </View>
      <BottomSearch
        value={query}
        onChangeText={(value) => {
          setQuery(value)
          setLimit(30)
        }}
        label={t('Search rules')}
        placeholder={t('Search rules')}
      />
      {matches.slice(0, limit).map((rule) => (
        <Row key={rule.id} accessibilityRole="button" onPress={() => setEditor({ rule })}>
          <View style={{ flex: 1, gap: space.s }}>
            <T weight="600">{rule.name}</T>
            <T tone="muted" size={font.caption}>
              {[
                rule.projectId
                  ? (store.projects.find(
                      (project) => project.computerId === hostId && project.id === `${hostId}:${rule.projectId}`,
                    )?.name ?? rule.projectId)
                  : t('All projects'),
                rule.providers.length ? rule.providers.map(providerName).join(', ') : t('All providers'),
                t(rule.enabled ? (rule.activation === 'always' ? 'Always' : 'Manual') : 'Disabled'),
              ].join(' · ')}
            </T>
          </View>
        </Row>
      ))}
      {matches.length > limit ? (
        <Button kind="ghost" title={t('Show more')} onPress={() => setLimit((value) => value + 30)} />
      ) : null}
      {!loading && !error && online && !matches.length ? <T tone="muted">{t('No rules found')}</T> : null}
      {editor ? (
        <RuleEditor
          key={editor.rule?.id ?? 'new'}
          hostId={hostId}
          rule={editor.rule}
          onClose={() => setEditor(null)}
          onSaved={() => void read()}
        />
      ) : null}
    </View>
  )
}

export function RuleEditor({
  hostId,
  rule,
  onClose,
  onSaved,
}: {
  hostId: string
  rule: Rule | null
  onClose: () => void
  onSaved: () => void
}) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string) => translate(store.language, key)
  const [draft, setDraft] = useState<RuleInput>(() => ({
    ...(rule ? { id: rule.id, baseRevision: rule.revision } : {}),
    name: rule?.name ?? '',
    body: rule?.body ?? '',
    projectId: rule?.projectId ?? null,
    providers: rule?.providers ?? [],
    activation: rule?.activation ?? 'always',
    enabled: rule?.enabled ?? true,
  }))
  const [scopeChosen, setScopeChosen] = useState(!!rule)
  const [providersChosen, setProvidersChosen] = useState(!!rule)
  const [history, setHistory] = useState<RuleRevision[] | null>(null)
  const [preview, setPreview] = useState<RuleRevision | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const online = store.isOnline(hostId)
  const owner = store.computers.find((computer) => computer.id === hostId)?.access !== 'viewer'
  const disabled = busy || !online || !owner
  const valid =
    !!draft.name.trim() &&
    !!draft.body.trim() &&
    draft.name.length <= RULE_NAME_LIMIT &&
    draft.body.length <= RULE_BODY_LIMIT &&
    scopeChosen &&
    providersChosen
  const act = async (work: () => Promise<unknown>, close = true) => {
    if (pending.current || !online || !owner || !live.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await work()
      if (live.current) {
        if (close) {
          onSaved()
          onClose()
        }
      }
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      pending.current = false
      if (live.current) setBusy(false)
    }
  }
  const inputStyle = {
    color: c.text,
    fontSize: font.body,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  }
  return (
    <Sheet
      open
      title={t(rule ? 'Edit rule' : 'New rule')}
      onClose={() => {
        if (!pending.current) onClose()
      }}
    >
      <View style={{ padding: space.l, gap: space.m }}>
        {error ? <T tone="bad">{error}</T> : null}
        {!online ? <T tone="muted">{t('Reconnect to use these controls.')}</T> : null}
        {!owner ? (
          <T tone="muted">
            {t('This device is view-only, so it cannot change this. Ask the host owner to pair it with full access.')}
          </T>
        ) : null}
        <TextInput
          value={draft.name}
          onChangeText={(name) => setDraft((value) => ({ ...value, name }))}
          editable={!disabled}
          maxLength={RULE_NAME_LIMIT}
          accessibilityLabel={t('Rule name')}
          placeholder={t('Rule name')}
          placeholderTextColor={c.placeholder}
          style={inputStyle}
        />
        <TextInput
          value={draft.body}
          onChangeText={(body) => setDraft((value) => ({ ...value, body }))}
          editable={!disabled}
          maxLength={RULE_BODY_LIMIT}
          multiline
          accessibilityLabel={t('Rule text')}
          placeholder={t('Rule text')}
          placeholderTextColor={c.placeholder}
          style={{ ...inputStyle, minHeight: 160, textAlignVertical: 'top' }}
        />
        <T weight="600">{t('Project scope')}</T>
        {!scopeChosen ? <T tone="muted">{t('Choose where this rule applies before saving.')}</T> : null}
        <Button
          kind={scopeChosen && draft.projectId === null ? 'secondary' : 'ghost'}
          title={t('All projects and no-project threads on this host')}
          disabled={disabled}
          onPress={() => {
            setScopeChosen(true)
            setDraft((value) => ({ ...value, projectId: null }))
          }}
        />
        {store.projects
          .filter((project) => project.computerId === hostId)
          .map((project) => (
            <Button
              key={project.id}
              kind={draft.projectId === project.id.slice(hostId.length + 1) && scopeChosen ? 'secondary' : 'ghost'}
              title={project.name}
              disabled={disabled}
              onPress={() => {
                setScopeChosen(true)
                setDraft((value) => ({ ...value, projectId: project.id.slice(hostId.length + 1) }))
              }}
            />
          ))}
        <T weight="600">{t('Providers')}</T>
        <Button
          kind={providersChosen && !draft.providers.length ? 'secondary' : 'ghost'}
          title={t('All providers')}
          disabled={disabled}
          onPress={() => {
            setProvidersChosen(true)
            setDraft((value) => ({ ...value, providers: [] }))
          }}
        />
        {AGENT_PROVIDERS.map((provider) => (
          <ToggleRow
            key={provider}
            title={providerName(provider)}
            value={providersChosen && draft.providers.includes(provider)}
            disabled={disabled}
            onChange={(enabled) => {
              setProvidersChosen(enabled || draft.providers.some((id) => id !== provider))
              setDraft((value) => ({
                ...value,
                providers: enabled
                  ? [...value.providers.filter((id) => id !== provider), provider]
                  : value.providers.filter((id) => id !== provider),
              }))
            }}
          />
        ))}
        <Segmented
          value={draft.activation}
          onChange={(activation) => {
            if (!disabled) setDraft((value) => ({ ...value, activation }))
          }}
          options={[
            { key: 'always', label: t('Always') },
            { key: 'manual', label: t('Manual') },
          ]}
        />
        <ToggleRow
          title={t('Enabled')}
          value={draft.enabled}
          disabled={disabled}
          onChange={(enabled) => setDraft((value) => ({ ...value, enabled }))}
        />
        <Button
          title={t('Save')}
          disabled={disabled || !valid}
          onPress={() => void act(() => store.invoke(hostId, 'rules.save', draft))}
        />
        {rule ? (
          <>
            <Button
              title={t('History')}
              kind="ghost"
              disabled={disabled}
              onPress={() =>
                void act(async () => {
                  const rows = await store.invoke(hostId, 'rules.history', rule.id)
                  if (live.current) setHistory(rows)
                }, false)
              }
            />
            {history?.map((entry) => (
              <Button
                key={entry.revision}
                kind="ghost"
                title={`${entry.revision} · ${entry.name}`}
                disabled={disabled}
                onPress={() => setPreview(entry)}
              />
            ))}
            {preview ? (
              <View style={{ gap: space.s }}>
                <T weight="600">{preview.name}</T>
                <T>{preview.body}</T>
                <Button
                  title={t('Use this revision')}
                  disabled={disabled}
                  onPress={() => {
                    setDraft((value) => ({ ...value, name: preview.name, body: preview.body }))
                    setPreview(null)
                  }}
                />
                <T tone="muted">{t('Review the restored text, then Save as a new revision.')}</T>
              </View>
            ) : null}
            <Button
              title={t('Delete rule')}
              kind="ghost"
              disabled={disabled}
              onPress={() =>
                Alert.alert(t('Delete rule?'), rule.name, [
                  { text: t('Cancel'), style: 'cancel' },
                  {
                    text: t('Delete'),
                    style: 'destructive',
                    onPress: () => void act(() => store.invoke(hostId, 'rules.remove', rule.id)),
                  },
                ])
              }
            />
          </>
        ) : null}
        <Button title={t('Cancel')} kind="ghost" disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  )
}
