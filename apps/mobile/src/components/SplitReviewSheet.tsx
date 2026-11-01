import { View } from 'react-native'
import { X } from 'lucide-react-native'
import { SPLIT_LIMIT } from '@ramu/shared/workspace/projectRouting'
import type { SplitDraft, SplitRow } from '../runtime/splitDraft'
import { useSay } from '../i18n'
import { font, radius, space, useTheme } from '../theme'
import { Field, TextField } from './ScheduleFields'
import { Button, Sheet, T, tap } from './ui'
import { Pressable } from 'react-native'

/** The review list for one Auto prompt that needs work in several projects. Nothing starts until **Start all**. */
export function SplitReviewSheet({
  draft,
  open,
  busy,
  onChange,
  onStart,
  onOneThread,
  onCancel,
}: {
  draft: SplitDraft | null
  open: boolean
  busy: boolean
  onChange: (draft: SplitDraft) => void
  onStart: () => void
  onOneThread: () => void
  onCancel: () => void
}) {
  const say = useSay()
  const { c } = useTheme()
  if (!draft) return null
  const update = (key: string, change: Partial<SplitRow>) =>
    onChange({ ...draft, rows: draft.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) })
  const ready = draft.rows.length > 0 && draft.rows.every((row) => row.title.trim() && row.brief.trim())
  return (
    <Sheet open={open} onClose={onCancel} title={say('Review threads to start')} presentation="screen">
      <View style={{ gap: space.l, paddingHorizontal: space.l, paddingBottom: space.xl }}>
        <T tone="muted">{say('This needs work in several projects. Review each thread, then start them together.')}</T>
        <Field label={say('Shared contract')}>
          <TextField
            multiline
            maxLength={4000}
            value={draft.contract}
            placeholder={say('What every thread must agree on, such as names, fields and endpoints')}
            onChangeText={(contract) => onChange({ ...draft, contract })}
          />
        </Field>
        {draft.rows.map((row) => (
          <View
            key={row.key}
            style={{ gap: space.s, backgroundColor: c.raised, borderRadius: radius.m, padding: space.m }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <T size={font.caption} tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                {row.label}
              </T>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={say('Remove this thread')}
                hitSlop={10}
                disabled={busy}
                onPress={() => {
                  tap()
                  onChange({ ...draft, rows: draft.rows.filter((entry) => entry.key !== row.key) })
                }}
              >
                <X size={16} color={c.muted} />
              </Pressable>
            </View>
            <TextField
              maxLength={200}
              value={row.title}
              placeholder={say('Thread title')}
              onChangeText={(title) => update(row.key, { title })}
            />
            <TextField
              multiline
              maxLength={8000}
              value={row.brief}
              placeholder={say('Brief for {0}', { '0': row.label })}
              onChangeText={(brief) => update(row.key, { brief })}
            />
          </View>
        ))}
        <View style={{ gap: space.s }}>
          <Button
            title={draft.rows.length === 1 ? say('Start thread') : say('Start {0} threads', { '0': draft.rows.length })}
            disabled={busy || !ready || draft.rows.length > SPLIT_LIMIT}
            onPress={onStart}
          />
          <Button kind="secondary" title={say('Start as one thread')} disabled={busy} onPress={onOneThread} />
          <Button kind="ghost" title={say('Cancel')} disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </Sheet>
  )
}
