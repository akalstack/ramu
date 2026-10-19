import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  hasMessageDraft,
  readSavedDrafts,
  savedDraftScopeKey,
  SavedDraftError,
  type MessageDraftSnapshot,
  type SavedDraftCommand,
  type SavedDraftScope,
  type SavedMessageDraft,
} from '@ramu/shared/chat/savedDrafts'
import { STANDALONE } from '../runtime/types'
import { savedMessagesKey } from '../runtime/savedMessageDrafts'
import { useStore } from '../runtime/store'
import { useT } from '../i18n'
import { font, space } from '../theme'
import { Button, Row, Sheet, T } from './ui'

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** Device-only actions. Nothing in this surface calls the thread/outbox delivery paths. */
export function useSavedMessageDrafts({
  hostId,
  scope,
  snapshot,
  uploading,
  busy,
  isUploading,
  isBusy,
  open,
  onClose,
  onApply,
}: {
  hostId: string
  scope?: SavedDraftScope
  snapshot: MessageDraftSnapshot
  uploading: boolean
  busy: boolean
  isUploading?: () => boolean
  isBusy?: () => boolean
  open: boolean
  onClose: () => void
  onApply: (snapshot: MessageDraftSnapshot) => void
}) {
  const store = useStore()
  const router = useRouter()
  const t = useT()
  const [all, setAll] = useState(false)
  const [selected, setSelected] = useState<SavedMessageDraft | null>(null)
  const [deleted, setDeleted] = useState<SavedMessageDraft | null>(null)
  const owner = JSON.stringify([hostId, scope ? savedDraftScopeKey(scope) : null])
  const current = useRef<string | null>(owner)
  const revision = useRef({ value: 0 }).current
  current.current = owner
  useEffect(() => {
    current.current = owner
    setAll(false)
    setSelected(null)
    setDeleted(null)
    return () => {
      revision.value++
      if (current.current === owner) current.current = null
    }
  }, [owner, revision])
  const rawLibrary = store.drafts[savedMessagesKey(hostId)] ?? null
  const { library, readError } = useMemo(() => {
    try {
      return { library: readSavedDrafts(rawLibrary, hostId), readError: false }
    } catch {
      return { library: null, readError: true }
    }
  }, [rawLibrary, hostId])
  const explanation = (error: unknown) => {
    if (error instanceof SavedDraftError) {
      if (error.code === 'full') return t.savedDraftFull
      if (error.code === 'recovery-size') return t.savedDraftRecoveryTooLarge
      if (error.code === 'uploading') return t.savedDraftUploading
      if (error.code === 'conflict') return t.savedDraftChanged
    }
    return t.savedDraftFailed
  }
  const move = (command: SavedDraftCommand, close: boolean) => {
    if (!scope || !library || busy || isBusy?.()) return
    if (uploading || isUploading?.()) return Alert.alert(t.savedDrafts, t.savedDraftUploading)
    try {
      const result = store.moveSavedDraft({
        hostId,
        key: scope.id,
        scope,
        expectedRevision: library.revision,
        expectedActive: snapshot,
        command,
      })
      onApply(result.active)
      if (result.deleted) setDeleted(result.deleted)
      if (command.kind === 'undo-delete') setDeleted(null)
      if (command.kind === 'restore' || command.kind === 'restore-here') setSelected(null)
      if (close) onClose()
      if (command.kind === 'save') AccessibilityInfo.announceForAccessibility(t.draftSaved)
    } catch (error) {
      Alert.alert(t.savedDrafts, explanation(error))
    }
  }
  const restore = (item: SavedMessageDraft, here = false) => {
    const capturedOwner = owner
    const capturedRevision = revision.value
    const action = () => {
      if (current.current !== capturedOwner || revision.value !== capturedRevision) return
      move(
        {
          kind: here ? 'restore-here' : 'restore',
          id: item.id,
          itemRevision: item.revision,
          ...(hasMessageDraft(snapshot) ? { parkId: uid() } : {}),
          at: Date.now(),
        },
        true,
      )
    }
    if (here)
      Alert.alert(
        t.useDraftHere,
        `${t.useDraftHereHint}${hasMessageDraft(snapshot) ? `\n\n${t.saveCurrentDraftHint}` : ''}`,
        [
          { text: t.cancel, style: 'cancel' },
          { text: hasMessageDraft(snapshot) ? t.saveCurrentAndRestore : t.useDraftHere, onPress: action },
        ],
      )
    else if (!hasMessageDraft(snapshot)) action()
    else
      Alert.alert(t.restoreDraft, t.saveCurrentDraftHint, [
        { text: t.cancel, style: 'cancel' },
        { text: t.saveCurrentAndRestore, onPress: action },
      ])
  }
  const items = (library?.items ?? []).filter(
    (item) => all || (scope && savedDraftScopeKey(item.scope) === savedDraftScopeKey(scope)),
  )
  const sameScope = selected && scope && savedDraftScopeKey(selected.scope) === savedDraftScopeKey(scope)
  const openOriginal = (item: SavedMessageDraft) => {
    if (item.scope.kind === 'thread') {
      const chat = store.chats.find(
        (chat) =>
          chat.computerId === hostId &&
          (item.scope.threadId
            ? chat.id === item.scope.threadId
            : `${hostId}:chat:${chat.taskId || chat.id}` === item.scope.id),
      )
      if (!chat) return Alert.alert(t.savedDrafts, t.savedDraftScopeMissing)
      onClose()
      router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
    } else {
      if (
        item.scope.projectId &&
        item.scope.projectId !== STANDALONE &&
        !store.projects.some((p) => p.computerId === hostId && p.id === item.scope.projectId)
      )
        return Alert.alert(t.savedDrafts, t.savedDraftScopeMissing)
      onClose()
      router.push({
        pathname: '/new',
        params: {
          computer: hostId,
          ...(item.scope.projectId ? { project: item.scope.projectId } : {}),
          ...(item.scope.contextId ? { draftContext: item.scope.contextId } : {}),
        },
      })
    }
  }
  return {
    save: () => move({ kind: 'save', id: uid(), at: Date.now(), uploadsPending: uploading }, true),
    canSave: !!scope && !!library && !busy && !uploading && hasMessageDraft(snapshot),
    count: items.length,
    sheet: (
      <Sheet open={open} onClose={onClose} title={selected ? t.previewDraft : t.savedDrafts}>
        <T tone="muted" size={font.caption} style={{ padding: space.l }}>
          {t.savedDraftDeviceHint}
        </T>
        {readError ? (
          <T tone="bad" style={{ padding: space.l }}>
            {t.savedDraftReadFailed}
          </T>
        ) : null}
        {selected ? (
          <View style={{ padding: space.l, gap: space.m }}>
            <Button kind="ghost" title={t.backToSavedDrafts} onPress={() => setSelected(null)} />
            <T tone="muted" size={font.caption}>
              {selected.scope.label ?? selected.scope.id}
            </T>
            <T selectable>{selected.snapshot.text}</T>
            {selected.snapshot.attachments.map((file) => (
              <T key={file.id} size={font.caption}>
                {file.name} · {t.attachmentNeedsCheck}
              </T>
            ))}
            {selected.snapshot.context.map((file, index) => (
              <View key={index} style={{ gap: space.s }}>
                <T size={font.caption}>{file.path}</T>
                {file.content ? (
                  <T selectable size={font.caption} tone="muted">
                    {file.content.slice(0, 4000)}
                  </T>
                ) : null}
                {file.content && file.content.length > 4000 ? (
                  <T tone="muted" size={font.caption}>
                    {t.savedContextPreviewTruncated}
                  </T>
                ) : null}
              </View>
            ))}
            <Button
              title={sameScope ? t.restoreDraft : t.openOriginalDraft}
              disabled={busy || uploading}
              onPress={() => (sameScope ? restore(selected) : openOriginal(selected))}
            />
            {!sameScope && scope ? (
              <>
                <T tone="muted" size={font.caption}>
                  {t.useDraftHereHint}
                </T>
                <Button
                  title={t.useDraftHere}
                  disabled={busy || uploading || !library}
                  onPress={() => restore(selected, true)}
                />
              </>
            ) : null}
            <Button
              kind="danger"
              title={t.deleteDraft}
              disabled={busy || uploading}
              onPress={() => {
                move({ kind: 'delete', id: selected.id, itemRevision: selected.revision }, false)
                setSelected(null)
              }}
            />
          </View>
        ) : (
          <>
            <Row accessibilityRole="button" onPress={() => setAll(!all)}>
              <T tone="accent">{all ? t.currentScopeDrafts : t.allHostDrafts}</T>
            </Row>
            {!items.length && !readError ? (
              <T tone="muted" style={{ padding: space.l }}>
                {t.noSavedDrafts}
              </T>
            ) : null}
            {items.map((item) => (
              <Row key={item.id} accessibilityRole="button" onPress={() => setSelected(item)}>
                <View style={{ gap: space.s, flex: 1 }}>
                  <T numberOfLines={2}>
                    {item.snapshot.text.trim() || item.snapshot.attachments[0]?.name || item.snapshot.context[0]?.path}
                  </T>
                  <T tone="muted" size={font.caption}>
                    {item.scope.label ?? item.scope.id} ·{' '}
                    {new Date(item.savedAt).toLocaleString(store.language === 'id' ? 'id-ID' : 'en-US')}
                  </T>
                </View>
              </Row>
            ))}
          </>
        )}
        {deleted ? (
          <Row accessibilityRole="button" onPress={() => move({ kind: 'undo-delete', item: deleted }, false)}>
            <T tone="accent">{t.undoDeleteDraft}</T>
          </Row>
        ) : null}
      </Sheet>
    ),
  }
}
