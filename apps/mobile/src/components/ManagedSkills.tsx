import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import type { ManagedSkill } from '@ramu/shared/types'
import { SKILL_ACTION_LABELS, skillActions, type SkillAction } from '@ramu/shared/skillControls'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { canWriteHost } from '../runtime/viewerAccess'
import { useSay } from '../i18n'
import { showError } from '../runtime/toast'
import { RowLabel } from './SettingRows'
import { Button, Card, Chip, Divider, Row, SectionLabel, Sheet, T } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'

/**
 * The skills Ramu manages on a host, as the desktop's Managed skills lists them: pin one so learning never rewrites it,
 * turn it off or archive it, bring it back, and restore an earlier revision when a learned change made it worse.
 */
export function ManagedSkills({ hostId, locked }: { hostId: string; locked: boolean }) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const online = store.isOnline(hostId)
  const computer = store.computers.find((entry) => entry.id === hostId)
  // A view-only device may not read the learning library at all, as with the reviews above it.
  const viewer = computer?.access === 'viewer'
  const writable = !locked && canWriteHost(computer)
  const [skills, setSkills] = useState<ManagedSkill[] | null>(null)
  const [archived, setArchived] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [history, setHistory] = useState<{ id: string; revisions: ManagedSkill[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void store.invoke(hostId, 'learning.get').then(
      (snapshot) => setSkills(snapshot.skills),
      () => setSkills([]),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store.invoke is stable; reloads when the host or its connection changes
  }, [hostId])
  useEffect(() => {
    if (online && !viewer) load()
  }, [online, viewer, load])
  if (!online || viewer) return null
  const run = (work: () => Promise<unknown>) => {
    if (busy || !writable) return
    setBusy(true)
    void work()
      .then(load)
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  const control = (skill: ManagedSkill, action: SkillAction) => {
    setOpen(null)
    run(() => store.invoke(hostId, 'learning.control', skill.id, action))
  }
  const readHistory = (skill: ManagedSkill) => {
    if (busy) return
    setBusy(true)
    void store
      .invoke(hostId, 'learning.history', skill.id)
      .then((revisions) => setHistory({ id: skill.id, revisions }))
      .catch((error: unknown) => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }
  const revert = (skill: ManagedSkill, revision: number) =>
    Alert.alert(
      say('Restore revision {0}?', { 0: revision }),
      say('{0} goes back to this revision. The current one stays in its history, so you can restore it later.', {
        0: skill.name,
      }),
      [
        { text: say('Cancel'), style: 'cancel' },
        {
          text: say('Restore'),
          onPress: () =>
            run(async () => {
              await store.invoke(hostId, 'learning.revert', skill.id, revision)
              const revisions = await store.invoke(hostId, 'learning.history', skill.id)
              setHistory({ id: skill.id, revisions })
            }),
        },
      ],
    )
  const shown = (skills ?? [])
    .filter((skill) => (skill.status === 'archived') === archived)
    .sort((a, b) => a.name.localeCompare(b.name))
  const current = skills?.find((skill) => skill.id === open) ?? null
  const revisions = current && history?.id === current.id ? history.revisions : null
  return (
    <>
      <SectionLabel
        right={
          <Chip
            label={archived ? say('Archived') : say('Active')}
            small
            selected={archived}
            onPress={() => setArchived((value) => !value)}
          />
        }
      >
        {say('Managed skills')}
      </SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {skills === null ? <ActivityIndicator color={c.accent} style={{ padding: space.m }} /> : null}
        {skills && !shown.length ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel
              title={archived ? say('Nothing archived') : say('No skills yet')}
              help={archived ? undefined : say('Ramu adds them here when it learns a skill worth repeating.')}
            />
          </Row>
        ) : null}
        {shown.slice(0, 100).map((skill, index) => (
          <View key={skill.id}>
            {index ? <Divider inset={space.l} /> : null}
            <Row
              accessibilityRole="button"
              style={{ paddingVertical: space.m }}
              onPress={() => {
                setHistory(null)
                setOpen(skill.id)
              }}
            >
              <RowLabel
                title={skill.name}
                description={skill.description ?? ''}
                help={[
                  skill.status === 'disabled' ? say('Off') : null,
                  skill.pinned ? say('Pinned') : null,
                  say('Read {0} times', { 0: skill.useCount }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </Row>
          </View>
        ))}
      </Card>
      <Sheet open={!!current} onClose={() => setOpen(null)} title={current?.name}>
        {current ? (
          <>
            <SheetGroup footer={writable ? undefined : say('Changing skills needs the Change settings permission.')}>
              {skillActions(current).map((action) => (
                <SheetOption
                  key={action}
                  title={say(SKILL_ACTION_LABELS[action])}
                  danger={action === 'archive'}
                  disabled={!writable || busy}
                  onPress={() => control(current, action)}
                />
              ))}
              <SheetOption title={say('History')} disabled={busy} onPress={() => readHistory(current)} />
            </SheetGroup>
            {revisions ? (
              <>
                <SectionLabel>{say('History')}</SectionLabel>
                <Card style={{ marginHorizontal: space.l }}>
                  {revisions.map((revision, index) => (
                    <View key={revision.revision}>
                      {index ? <Divider inset={space.l} /> : null}
                      <View style={{ padding: space.m, gap: space.xs }}>
                        <T weight="500">
                          {say('Revision {0}', { 0: revision.revision })}
                          {revision.revision === current.revision ? ` · ${say('Current')}` : ''}
                        </T>
                        <T size={font.caption} tone="muted">
                          {[new Date(revision.updatedAt).toLocaleString(), revision.changeNote]
                            .filter(Boolean)
                            .join(' · ')}
                        </T>
                        <T size={font.caption} numberOfLines={6} selectable>
                          {revision.content}
                        </T>
                        {revision.revision !== current.revision ? (
                          <View style={{ flexDirection: 'row', paddingTop: space.xs }}>
                            <Button
                              kind="secondary"
                              title={say('Restore revision')}
                              disabled={!writable || busy}
                              onPress={() => revert(current, revision.revision)}
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  )
}
