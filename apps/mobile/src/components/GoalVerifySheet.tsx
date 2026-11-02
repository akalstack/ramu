import { useEffect, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import type { ChatGoal } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { fill, useT } from '../i18n'
import { outcomeKey, verifyDraft, verifyView, VERIFY_LIMIT } from '../runtime/goalVerify'
import { Button, Sheet, SheetScrollView, T } from './ui'

/**
 * Edits the command Ramu runs itself when the agent says the goal is done, mirroring the desktop's goal bar: the current
 * command and its last result sit above one field, and a blank field (or `off`) removes it.
 */
export function GoalVerifySheet({
  open,
  goal,
  onClose,
  onSave,
}: {
  open: boolean
  goal: ChatGoal
  onClose: () => void
  /** Resolves once the host applied it; rejects with the host's reason. */
  onSave: (command: string | null) => Promise<void>
}) {
  const { c } = useTheme()
  const t = useT()
  const [draft, setDraft] = useState(goal.verify ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each opening starts from what the host has now, not from a draft that was abandoned.
  useEffect(() => {
    if (open) {
      setDraft(goal.verify ?? '')
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const view = verifyDraft(draft, goal.verify)
  const facts = verifyView(goal)
  const check = facts.check
  const how = check ? outcomeKey(check.outcome) : null
  const save = async () => {
    if (view.tooLong || saving) return
    if (!view.changed) return onClose()
    setSaving(true)
    setError(null)
    try {
      await onSave(view.command)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const mono = { fontFamily: font.mono, fontSize: font.caption + 0.5 }
  return (
    <Sheet open={open} onClose={onClose} title={t.verifyCommand} scroll={false}>
      <SheetScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
        <View style={{ paddingHorizontal: space.l, gap: space.m }}>
          <View style={{ gap: 4 }}>
            <T size={font.caption} weight="600" tone="muted">
              {t.verifyCurrent}
            </T>
            {facts.command ? (
              <T tone="soft" copyable={facts.command} style={mono}>
                {facts.command}
              </T>
            ) : (
              <T size={font.control} tone="muted">
                {t.verifyNone}
              </T>
            )}
          </View>
          {check && how ? (
            <View style={{ gap: 4 }}>
              <T size={font.caption} weight="600" tone="muted">
                {t.verifyLastCheck}
              </T>
              <T size={font.control} tone={check.ok ? 'ok' : 'warn'}>
                {how.key === 'verifyExit' ? fill(t.verifyExit, how.code ?? 0) : t[how.key]}
                {' · '}
                <T tone="soft" style={mono}>
                  {check.command}
                </T>
              </T>
              {check.tail ? (
                <View style={{ backgroundColor: c.fill, borderRadius: radius.s, padding: space.s, maxHeight: 140 }}>
                  <ScrollView nestedScrollEnabled>
                    <T tone="soft" copyable={check.tail} style={mono}>
                      {check.tail}
                    </T>
                  </ScrollView>
                </View>
              ) : null}
            </View>
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            accessibilityLabel={t.verifyCommand}
            placeholder={t.verifyField}
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            style={{
              ...mono,
              color: c.text,
              backgroundColor: c.raised2,
              borderRadius: radius.m,
              paddingHorizontal: space.l,
              paddingVertical: space.m,
              minHeight: 46,
            }}
          />
          <T size={font.caption} tone={view.tooLong || error ? 'bad' : 'muted'}>
            {error ?? (view.tooLong ? fill(t.verifyTooLong, VERIFY_LIMIT) : t.verifyHint)}
          </T>
          <View style={{ flexDirection: 'row', gap: space.m, justifyContent: 'flex-end' }}>
            <Button title={t.cancel} kind="ghost" onPress={onClose} />
            <Button
              title={view.command || !goal.verify ? t.save : t.verifyRemove}
              kind={view.command || !goal.verify ? 'primary' : 'danger'}
              disabled={view.tooLong || !view.changed || saving}
              onPress={() => void save()}
            />
          </View>
        </View>
      </SheetScrollView>
    </Sheet>
  )
}
