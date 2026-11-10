import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, Share, TextInput, View } from 'react-native'
import {
  artifactLink,
  declaredCapabilities,
  type ArtifactInfo,
  type ArtifactRun,
  type ArtifactShare,
  type PublicArtifactStatus,
} from '@ramu/shared/artifacts'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { showToast } from '../runtime/toast'
import { Button, Divider, SectionLabel, Sheet, T, tap } from './ui'

const RUN_STATUS: Record<ArtifactRun['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  undone: 'Undone',
}

/**
 * An artifact's settings on the phone, as the desktop's Artifact settings has them for someone away from the computer:
 * its name, opening it to anyone (and closing it again), share links for paired devices, what its runs changed with
 * Undo run, and Delete. Grants stay in the toolbar's Allow sheet.
 */
export function ArtifactSettings({
  computerId,
  page,
  open,
  onClose,
  onChanged,
  onDeleted,
}: {
  computerId: string
  page: ArtifactInfo
  open: boolean
  onClose(): void
  onChanged(): void
  onDeleted(): void
}) {
  const store = useStore()
  const say = useSay()
  const { c } = useTheme()
  const [title, setTitle] = useState(page.title)
  const [editor, setEditor] = useState('')
  const [shares, setShares] = useState<ArtifactShare[]>([])
  const [runs, setRuns] = useState<ArtifactRun[]>([])
  const [status, setStatus] = useState<PublicArtifactStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const viewer = store.computers.find((x) => x.id === computerId)?.access === 'viewer'
  const online = store.isOnline(computerId)
  const load = useCallback(() => {
    void store
      .invoke(computerId, 'artifacts.shares', page.id)
      .then(setShares)
      .catch(() => {})
    void store
      .invoke(computerId, 'artifacts.runs', page.id)
      .then(setRuns)
      .catch(() => {})
    void store
      .invoke(computerId, 'artifacts.publicStatus', page.id)
      .then(setStatus)
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store.invoke is stable for the screen's life
  }, [computerId, page.id])
  useEffect(() => {
    if (open && online) load()
  }, [open, online, load])
  useEffect(() => setTitle(page.title), [page.title])
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return
    tap()
    setBusy(true)
    try {
      await work()
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const shareLink = (share: ArtifactShare) => artifactLink({ computerId, artifactId: page.id, share: share.token })
  const servable = declaredCapabilities(page.capabilities).length === 0
  const publicOpen = !!status && status.state !== 'off'
  const editable = page.kind === 'doc' || page.kind === 'diagram' || page.kind === 'slides'
  const writable = online && !viewer
  const field = {
    color: c.text,
    fontSize: font.body,
    padding: space.m,
    borderRadius: radius.m,
    backgroundColor: c.raised2,
  }
  return (
    <Sheet open={open} onClose={onClose} title={say('Artifact settings')}>
      <View style={{ padding: space.l, gap: space.s }}>
        <T size={font.caption} tone="muted">
          {say('Name')}
        </T>
        <TextInput
          editable={writable}
          value={title}
          maxLength={120}
          onChangeText={setTitle}
          returnKeyType="done"
          placeholderTextColor={c.placeholder}
          style={field}
        />
        <Button
          kind="secondary"
          title={say('Save')}
          disabled={!writable || busy || !title.trim() || title.trim() === page.title}
          onPress={() =>
            void act(async () => {
              await store.invoke(computerId, 'artifacts.update', page.id, { title: title.trim() })
              onChanged()
            })
          }
        />
      </View>

      <SectionLabel>{say('Open to anyone')}</SectionLabel>
      <View style={{ paddingHorizontal: space.l, gap: space.s }}>
        <T size={font.caption} tone="muted">
          {servable
            ? say(
                'Anyone with the link sees this artifact, without Ramu, while this host is on. It gets its own address through your Cloudflare or ngrok tool and serves only this artifact.',
              )
            : say(
                'An artifact that keeps records or uses this host’s features cannot be opened to people without Ramu.',
              )}
        </T>
        {publicOpen ? (
          <T size={font.caption} tone={status.state === 'failed' ? 'bad' : 'soft'} selectable>
            {status.url ??
              (status.state === 'missing'
                ? say('Install cloudflared or ngrok on this host to open artifacts to anyone.')
                : status.state === 'failed'
                  ? (status.error ?? say('The tunnel stopped. Ramu is retrying.'))
                  : say('Starting…'))}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          {servable ? (
            <Button
              kind={publicOpen ? 'danger' : 'secondary'}
              title={publicOpen ? say('Close to everyone') : say('Open to anyone')}
              disabled={!writable || busy}
              onPress={() =>
                void act(() =>
                  store.invoke(computerId, publicOpen ? 'artifacts.closePublic' : 'artifacts.openPublic', page.id),
                )
              }
            />
          ) : null}
          {status?.url ? (
            <Button
              kind="ghost"
              title={say('Share link')}
              onPress={() => void Share.share({ title: page.title, message: status.url!, url: status.url! })}
            />
          ) : null}
        </View>
      </View>

      <SectionLabel>{say('Share links')}</SectionLabel>
      <View style={{ paddingHorizontal: space.l, gap: space.s }}>
        <T size={font.caption} tone="muted">
          {say('For devices paired with this host. Links expire after 30 days unless renewed.')}
        </T>
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          <Button
            kind="secondary"
            title={say('Read-only link')}
            disabled={!writable || busy}
            onPress={() => void act(() => store.invoke(computerId, 'artifacts.share', page.id, false))}
          />
          {page.capabilities.records ? (
            <Button
              kind="secondary"
              title={say('Link that can add records')}
              disabled={!writable || busy}
              onPress={() => void act(() => store.invoke(computerId, 'artifacts.share', page.id, true))}
            />
          ) : null}
        </View>
        {editable ? (
          <View style={{ gap: space.s }}>
            <TextInput
              editable={writable}
              value={editor}
              maxLength={60}
              onChangeText={setEditor}
              placeholder={say('Who may edit its text')}
              placeholderTextColor={c.placeholder}
              style={field}
            />
            <Button
              kind="secondary"
              title={say('Link that lets them edit')}
              disabled={!writable || busy || !editor.trim()}
              onPress={() =>
                void act(async () => {
                  await store.invoke(computerId, 'artifacts.share', page.id, false, editor.trim())
                  setEditor('')
                })
              }
            />
          </View>
        ) : null}
        {shares.map((share) => (
          <View key={share.token} style={{ gap: space.xs }}>
            <Divider />
            <T size={font.caption}>
              {share.editor
                ? say('{name} can edit', { name: share.editor })
                : share.canAdd
                  ? say('Can add records')
                  : say('Read-only')}{' '}
              · {say('expires {when}', { when: new Date(share.expiresAt).toLocaleDateString() })}
            </T>
            <View style={{ flexDirection: 'row', gap: space.m }}>
              <TextAction
                label={say('Share link')}
                onPress={() =>
                  void Share.share({ title: page.title, message: shareLink(share), url: shareLink(share) })
                }
              />
              <TextAction
                label={say('Renew')}
                disabled={!writable || busy}
                onPress={() => void act(() => store.invoke(computerId, 'artifacts.renewShare', share.token))}
              />
              <TextAction
                label={say('Revoke')}
                danger
                disabled={!writable || busy}
                onPress={() => void act(() => store.invoke(computerId, 'artifacts.revokeShare', share.token))}
              />
            </View>
          </View>
        ))}
      </View>

      {runs.length ? (
        <>
          <SectionLabel>{say('History')}</SectionLabel>
          <View style={{ paddingHorizontal: space.l, gap: space.s }}>
            {runs.slice(0, 20).map((run, index) => (
              <View key={run.id} style={{ gap: space.xs }}>
                {index ? <Divider /> : null}
                <T size={font.control} numberOfLines={2}>
                  {run.name ? (page.capabilities.runs?.[run.name]?.label ?? run.name) : run.task.slice(0, 60)}
                </T>
                <T size={font.caption} tone={run.status === 'failed' ? 'bad' : 'muted'}>
                  {[
                    say(RUN_STATUS[run.status]),
                    new Date(run.startedAt).toLocaleString(),
                    run.changes ? say('{count} changes', { count: run.changes }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </T>
                {run.error ? (
                  <T size={font.caption} tone="bad">
                    {run.error}
                  </T>
                ) : null}
                {run.changes > 0 && run.status !== 'undone' && run.status !== 'running' ? (
                  <TextAction
                    label={say('Undo run')}
                    disabled={!writable || busy}
                    onPress={() => void act(() => store.invoke(computerId, 'artifacts.runUndo', run.id))}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={{ padding: space.l }}>
        <Button
          kind="danger"
          title={say('Delete')}
          disabled={!writable || busy}
          onPress={() =>
            Alert.alert(say('Delete {title}?', { title: page.title }), undefined, [
              { text: say('Cancel'), style: 'cancel' },
              {
                text: say('Delete artifact'),
                style: 'destructive',
                onPress: () =>
                  void act(async () => {
                    await store.invoke(computerId, 'artifacts.delete', page.id)
                    onDeleted()
                  }),
              },
            ])
          }
        />
      </View>
    </Sheet>
  )
}

function TextAction({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string
  onPress(): void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} hitSlop={8} onPress={onPress}>
      <T size={font.caption} weight="600" tone={disabled ? 'muted' : danger ? 'bad' : 'accent'}>
        {label}
      </T>
    </Pressable>
  )
}
