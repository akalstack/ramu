import { useEffect, useRef, useState } from 'react'
import { TextInput, View } from 'react-native'
import { font, radius, space, useTheme } from '../theme'
import { useT } from '../i18n'
import { isMethodMissing } from '../runtime/goalVerify'
import { Button, Sheet, T } from './ui'

export function WorkspaceNameSheet({
  workspace,
  online,
  onSave,
  onClose,
}: {
  workspace: { id: string; name: string }
  online: boolean
  onSave: (name: string, before: string) => Promise<void>
  onClose: () => void
}) {
  const { c } = useTheme()
  const t = useT()
  const before = useRef(workspace.name).current
  const [name, setName] = useState(before)
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
  const save = async () => {
    if (!online || !name.trim() || name.trim().length > 200 || pending.current) return
    if (name.trim() === before) return onClose()
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await onSave(name.trim(), before)
      if (live.current) onClose()
    } catch (reason) {
      if (live.current) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(
          isMethodMissing(reason)
            ? t.workspaceRenameOutdated
            : /Workspace name changed elsewhere/.test(message)
              ? t.workspaceRenameConflict
              : message,
        )
      }
    } finally {
      pending.current = false
      if (live.current) setBusy(false)
    }
  }
  const close = () => {
    if (!pending.current) onClose()
  }
  return (
    <Sheet open onClose={close} title={t.renameWorkspace}>
      <View style={{ paddingHorizontal: space.l, gap: space.m }}>
        <T tone="muted">{t.workspaceNameHint}</T>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={200}
          editable={online && !busy}
          autoFocus
          selectTextOnFocus
          accessibilityLabel={t.workspaceName}
          placeholder={t.workspaceName}
          placeholderTextColor={c.placeholder}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          style={{
            color: c.text,
            backgroundColor: c.raised2,
            borderRadius: radius.m,
            paddingHorizontal: space.l,
            paddingVertical: space.m,
            fontSize: font.body,
            minHeight: 46,
          }}
        />
        {!online ? <T tone="muted">{t.workspaceRenameOffline}</T> : null}
        {error ? (
          <T tone="bad" accessibilityRole="alert">
            {error}
          </T>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.m }}>
          <Button title={t.cancel} kind="ghost" disabled={busy} onPress={close} />
          <Button
            title={t.save}
            disabled={!online || busy || !name.trim() || name.trim().length > 200}
            onPress={() => void save()}
          />
        </View>
      </View>
    </Sheet>
  )
}
