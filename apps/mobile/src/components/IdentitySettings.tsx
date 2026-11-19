import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { IDENTITY_COLORS, parseRule, ruleText, type Identity, type IdentitySnapshot } from '@ramu/shared/identities'
import { useStore } from '../runtime/store'
import { space, useTheme } from '../theme'
import { ChoiceRow, RowLabel, TextRow } from './SettingRows'
import { Button, Card, Divider, Row, SectionLabel, T } from './ui'

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

/**
 * A host's identities on the phone: each one's name, color, Git author and rules, which connected accounts belong to
 * it, and which identity each project uses. Editing needs the device's settings changes permission; without it the
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
  if (!snapshot) return online ? <ActivityIndicator color={c.accent} style={{ padding: space.l }} /> : null
  const { identities } = snapshot.settings
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
          <SectionLabel>{identity.name}</SectionLabel>
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
              onCommit={(email) =>
                act(() =>
                  invoke(hostId, 'identities.update', identity.id, { gitAuthor: { ...identity.gitAuthor, email } }),
                )
              }
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
                  gitAuthor: identities[0]?.gitAuthor ?? { name: t('Your name'), email: 'you@example.com' },
                }),
              )
            }
          />
        </Row>
      ) : null}
    </View>
  )
}
