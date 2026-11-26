import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { IDENTITY_COLORS, parseRule, ruleText, type Identity, type IdentitySnapshot } from '@ramu/shared/identities'
import { useStore } from '../runtime/store'
import { showToast } from '../runtime/toast'
import { font, space, useTheme } from '../theme'
import { ChoiceRow, RowLabel, TextRow } from './SettingRows'
import { SheetGroup, SheetOption } from './SheetOptions'
import { Button, Card, Divider, Row, SectionLabel, Sheet, T } from './ui'

const COLOR_NAMES: Record<Identity['color'], string> = {
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  pink: 'Pink',
  teal: 'Teal',
  gray: 'Gray',
}

/** The same hues the desktop's dots use (Tailwind's 500s), so an identity is one color on every device. */
const COLOR_HEX: Record<Identity['color'], string> = {
  violet: '#8b5cf6',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  pink: '#ec4899',
  teal: '#14b8a6',
  gray: '#6b7280',
}

/**
 * A host's identities on the phone, as the desktop has them: each one's name, color, Git author and rules (with the
 * rules Ramu suggests), which is the default, removing one, which connected accounts belong to it, which identity each
 * project uses, and writing a project's author to its Git config. Editing needs the device's settings changes permission; without it the
 * page is read-only. Connecting a new account follows that account's own rules on the host.
 */
export function IdentitySettings({ hostId, locked }: { hostId: string; locked: boolean }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const online = store.isOnline(hostId)
  const [snapshot, setSnapshot] = useState<IdentitySnapshot | null>(null)
  const [error, setError] = useState('')
  const runtime = useRef(store)
  runtime.current = store
  useEffect(() => {
    if (!online) return
    let active = true
    const read = () =>
      void runtime.current.invoke(hostId, 'identities.get').then(
        (next) => active && setSnapshot(next),
        (reason: unknown) => active && setError(reason instanceof Error ? reason.message : String(reason)),
      )
    read()
    const unsubscribe = runtime.current.subscribe(hostId, (...[channel]) => {
      if (channel === 'identities:changed') read()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [hostId, online])
  const act = (run: () => Promise<IdentitySnapshot>) =>
    void run().then(setSnapshot, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
  const invoke = runtime.current.invoke
  // The identity being removed, while the person chooses where its projects go.
  const [removing, setRemoving] = useState<Identity | null>(null)
  if (!snapshot)
    return online ? (
      <ActivityIndicator color={c.accent} style={{ padding: space.l }} />
    ) : (
      <T tone="muted" style={{ padding: space.l }}>
        {t('Reconnect this host to see its identities.')}
      </T>
    )
  const { identities } = snapshot.settings
  const usedBy = (id: string) =>
    snapshot.projects.filter((entry) => entry.identityId === id).map((entry) => projectName(entry.projectId))
  // Rules Ramu suggests from projects no rule catches yet, less the ones an identity already has.
  const suggested = (identity: Identity) =>
    [...new Set((snapshot.suggestions ?? []).map((entry) => ruleText(entry.rule)))]
      .filter((text) => !identities.some((entry) => entry.rules.some((rule) => ruleText(rule) === text)))
      .slice(0, 3)
      .map((text) => ({ text, rule: parseRule(text), identity }))
  const projectName = (id: string) =>
    store.projects.find((project) => project.computerId === hostId && project.id.endsWith(`:${id}`))?.name ?? id
  return (
    <View>
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l }}>
          {error}
        </T>
      ) : null}
      {!identities.length ? (
        <T tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.l }}>
          {t(
            'With one account of each kind nothing changes. Add identities once you connect a second account, such as a work login.',
          )}
        </T>
      ) : null}
      {identities.map((identity) => (
        <View key={identity.id}>
          <SectionLabel
            right={
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: COLOR_HEX[identity.color] }} />
            }
          >
            {identity.isDefault ? `${identity.name} · ${t('Default')}` : identity.name}
          </SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <TextRow
              title={t('Name')}
              value={identity.name}
              maxLength={60}
              disabled={locked}
              onCommit={(name) => act(() => invoke(hostId, 'identities.update', identity.id, { name }))}
            />
            <Divider inset={space.l} />
            <ChoiceRow
              title={t('Color')}
              value={identity.color}
              options={IDENTITY_COLORS.map((color) => ({ value: color, label: t(COLOR_NAMES[color]) }))}
              disabled={locked}
              onChange={(color) =>
                act(() => invoke(hostId, 'identities.update', identity.id, { color: color as Identity['color'] }))
              }
            />
            <Divider inset={space.l} />
            <TextRow
              title={t('Git author name')}
              value={identity.gitAuthor.name}
              maxLength={120}
              disabled={locked}
              onCommit={(name) =>
                act(() =>
                  invoke(hostId, 'identities.update', identity.id, { gitAuthor: { ...identity.gitAuthor, name } }),
                )
              }
            />
            <Divider inset={space.l} />
            <TextRow
              title={t('Git author email')}
              value={identity.gitAuthor.email}
              maxLength={200}
              disabled={locked}
              onCommit={(email) => {
                if (!/^[^\s@]+@[^\s@]+$/.test(email.trim()))
                  return setError(t('Enter an email address, such as you@example.com.'))
                setError('')
                act(() =>
                  invoke(hostId, 'identities.update', identity.id, {
                    gitAuthor: { ...identity.gitAuthor, email: email.trim() },
                  }),
                )
              }}
            />
            <Divider inset={space.l} />
            <TextRow
              title={t('Rules')}
              help={t('One per line: a folder such as ~/work/** or a remote such as github.com/acme.')}
              value={identity.rules.map(ruleText).join('\n')}
              maxLength={4000}
              disabled={locked}
              onCommit={(text) => {
                const rules = text.split('\n').map(parseRule)
                if (rules.some((entry, index) => !entry && text.split('\n')[index]!.trim()))
                  return setError(t('Use a folder such as ~/work/** or a remote such as github.com/acme.'))
                act(() =>
                  invoke(hostId, 'identities.update', identity.id, {
                    rules: rules.filter((entry): entry is NonNullable<typeof entry> => !!entry),
                  }),
                )
              }}
            />
            {!locked && suggested(identity).length ? (
              <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s }}>
                <T size={font.caption} tone="muted">
                  {t('Suggested:')}
                </T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {suggested(identity).map(({ text, rule }) => (
                    <Button
                      key={text}
                      kind="secondary"
                      title={text}
                      accessibilityLabel={t('Add rule {0}', { 0: text })}
                      onPress={() =>
                        rule &&
                        act(() =>
                          invoke(hostId, 'identities.update', identity.id, { rules: [...identity.rules, rule] }),
                        )
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <Divider inset={space.l} />
            <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
              {usedBy(identity.id).length
                ? t('Used by {names}', { names: usedBy(identity.id).join(', ') })
                : t('No project uses it yet.')}
            </T>
            {!locked && (!identity.isDefault || identities.length >= 2) ? (
              <>
                <Divider inset={space.l} />
                <View style={{ flexDirection: 'row', gap: space.s, padding: space.l }}>
                  {!identity.isDefault ? (
                    <Button
                      kind="secondary"
                      title={t('Make default')}
                      onPress={() => act(() => invoke(hostId, 'identities.update', identity.id, { isDefault: true }))}
                    />
                  ) : null}
                  {identities.length >= 2 ? (
                    <Button
                      kind="ghost"
                      title={t('Remove')}
                      accessibilityLabel={t('Remove {name}', { name: identity.name })}
                      onPress={() => setRemoving(identity)}
                    />
                  ) : null}
                </View>
              </>
            ) : null}
          </Card>
        </View>
      ))}
      {identities.length >= 2 ? (
        <>
          <SectionLabel>{t('Accounts')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {snapshot.accounts.map((account, index) => {
              const owners = snapshot.settings.accounts[account.key] ?? []
              return (
                <View key={account.key}>
                  {index ? <Divider inset={space.l} /> : null}
                  <ChoiceRow
                    title={account.label}
                    value={owners.length === 1 ? owners[0] : ''}
                    options={[
                      { value: '', label: t('All identities') },
                      ...identities.map((entry) => ({ value: entry.id, label: entry.name })),
                    ]}
                    disabled={locked}
                    onChange={(value) =>
                      act(() => invoke(hostId, 'identities.assign', account.key, value ? [String(value)] : []))
                    }
                  />
                </View>
              )
            })}
          </Card>
          <SectionLabel>{t('Projects')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {snapshot.projects.map((entry, index) => (
              <View key={entry.projectId}>
                {index ? <Divider inset={space.l} /> : null}
                <ChoiceRow
                  title={projectName(entry.projectId)}
                  help={
                    entry.reason === 'pinned'
                      ? t('Pinned')
                      : entry.reason === 'rule'
                        ? t('Picked by a rule')
                        : t('Default identity')
                  }
                  value={entry.reason === 'pinned' ? entry.identityId : ''}
                  options={[
                    { value: '', label: t('Follow its rules') },
                    ...identities.map((identity) => ({ value: identity.id, label: identity.name })),
                  ]}
                  disabled={locked}
                  onChange={(value) =>
                    act(() => invoke(hostId, 'identities.pin', entry.projectId, value ? String(value) : null))
                  }
                />
                {!locked ? (
                  <View style={{ paddingHorizontal: space.l, paddingBottom: space.m, alignItems: 'flex-start' }}>
                    <Button
                      kind="ghost"
                      title={t('Write to Git config')}
                      accessibilityLabel={t(
                        'Sets user.name and user.email in its repositories, for commits made outside Ramu.',
                      )}
                      onPress={() =>
                        Alert.alert(
                          t('Write to Git config'),
                          t('Sets user.name and user.email in its repositories, for commits made outside Ramu.'),
                          [
                            { text: t('Cancel'), style: 'cancel' },
                            {
                              text: t('Write to Git config'),
                              onPress: () =>
                                void invoke(hostId, 'identities.writeGitConfig', entry.projectId).then(
                                  (done) => showToast(done.email, undefined, { success: true }),
                                  (reason: unknown) =>
                                    setError(reason instanceof Error ? reason.message : String(reason)),
                                ),
                            },
                          ],
                        )
                      }
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {!locked ? (
        <Row style={{ paddingVertical: space.m, paddingHorizontal: space.l }}>
          <RowLabel title={t('Add identity')} help={t('Name it and set its Git author; then put accounts in it.')} />
          <Button
            kind="secondary"
            title={t('Add')}
            onPress={() =>
              act(() =>
                invoke(hostId, 'identities.add', {
                  name: identities.length ? t('Work') : t('Personal'),
                  // The host's own Git author for the first one; a later one starts from the first and is edited.
                  gitAuthor: identities[0]?.gitAuthor ?? {
                    name: snapshot.gitUser.name ?? t('Your name'),
                    email: snapshot.gitUser.email ?? 'you@example.com',
                  },
                }),
              )
            }
          />
        </Row>
      ) : null}
      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? t('Remove {name}?', { name: removing.name }) : ''}
      >
        <SheetGroup title={t('Move its projects to')}>
          {identities
            .filter((entry) => entry.id !== removing?.id)
            .map((entry) => (
              <SheetOption
                key={entry.id}
                title={entry.name}
                onPress={() => {
                  const gone = removing
                  setRemoving(null)
                  if (gone) act(() => invoke(hostId, 'identities.remove', gone.id, entry.id))
                }}
              />
            ))}
        </SheetGroup>
      </Sheet>
    </View>
  )
}
