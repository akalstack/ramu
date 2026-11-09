import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { Trash2 } from 'lucide-react-native'
import type { ForgeService, ReviewVerdict } from '@ramu/shared/types'
import { reviewVerdicts } from '@ramu/shared/pullRequestReadiness'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { SheetGroup, SheetOption } from './SheetOptions'
import { Button, IconButton, Sheet, T } from './ui'

/** A line comment waiting to go out with the review, on the new side of `line` in `path`. */
export interface PendingComment {
  id: string
  path: string
  line: number
  body: string
}

/** The services' longest comment, which the host also enforces. */
const MAX_COMMENT = 20_000

/** The desktop's review choices, with its English copy keys. */
const VERDICTS: { value: ReviewVerdict; label: string; help: string }[] = [
  { value: 'comment', label: 'Comment', help: 'Submit general feedback without explicit approval.' },
  { value: 'approve', label: 'Approve', help: 'Submit feedback and approve merging these changes.' },
  {
    value: 'request-changes',
    label: 'Request changes',
    help: 'Submit feedback that must be addressed before merging.',
  },
]

function CommentInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const { c } = useTheme()
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      multiline
      maxLength={MAX_COMMENT}
      placeholder={placeholder}
      placeholderTextColor={c.placeholder}
      accessibilityLabel={placeholder}
      style={{
        color: c.text,
        backgroundColor: c.fill,
        borderRadius: radius.m,
        padding: space.m,
        paddingTop: space.m,
        minHeight: 96,
        maxHeight: 220,
        fontSize: font.control,
        textAlignVertical: 'top',
      }}
    />
  )
}

/** Writes one line comment for the review; it waits as pending until Finish review sends them together. */
export function LineCommentSheet({
  path,
  line,
  onAdd,
  onClose,
}: {
  path: string
  line: number
  onAdd: (body: string) => void
  onClose: () => void
}) {
  const say = useSay()
  const [body, setBody] = useState('')
  return (
    <Sheet open onClose={onClose} title={say('Comment on line {0}', { 0: line })}>
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <T size={font.caption} tone="muted" mono numberOfLines={2}>
          {path}
        </T>
        <CommentInput value={body} onChange={setBody} placeholder={say('Leave a comment')} />
        <Button
          title={say('Add to review')}
          disabled={!body.trim()}
          onPress={() => {
            onAdd(body.trim())
            onClose()
          }}
        />
      </View>
    </Sheet>
  )
}

/**
 * Finishes the person's review, as on the desktop and the services: a summary, the line comments waiting to go with it
 * (each removable), and a verdict.
 */
export function FinishReviewSheet({
  service,
  own,
  pending,
  busy,
  error,
  onRemove,
  onSubmit,
  onClose,
}: {
  service: ForgeService
  own: boolean
  pending: PendingComment[]
  busy: boolean
  error: string | null
  onRemove: (id: string) => void
  onSubmit: (verdict: ReviewVerdict, body: string) => void
  onClose: () => void
}) {
  const say = useSay()
  const allowed = reviewVerdicts(service, own)
  const [verdict, setVerdict] = useState<ReviewVerdict>('comment')
  const [body, setBody] = useState('')
  // A plain comment needs words or line comments; an approval may say nothing.
  const empty = verdict !== 'approve' && !body.trim() && !pending.length
  return (
    <Sheet open onClose={() => !busy && onClose()} title={say('Finish review')}>
      <View style={{ paddingHorizontal: space.l, gap: space.m }}>
        <CommentInput value={body} onChange={setBody} placeholder={say('Leave a comment')} />
      </View>
      <SheetGroup title={say('Review')}>
        {VERDICTS.filter((entry) => allowed.includes(entry.value)).map((entry) => (
          <SheetOption
            key={entry.value}
            title={say(entry.label)}
            help={say(entry.help)}
            selected={verdict === entry.value}
            onPress={() => setVerdict(entry.value)}
          />
        ))}
      </SheetGroup>
      {pending.length ? (
        <SheetGroup title={say('{0} line comments', { 0: pending.length })}>
          {pending.map((comment) => (
            <SheetOption
              key={comment.id}
              title={`${comment.path}:${comment.line}`}
              help={comment.body}
              trailing={
                <IconButton
                  icon={Trash2}
                  label={say('Remove comment')}
                  size={34}
                  tone="muted"
                  onPress={() => onRemove(comment.id)}
                />
              }
            />
          ))}
        </SheetGroup>
      ) : null}
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.s }}>
        {error ? (
          <T size={font.control} tone="bad">
            {error}
          </T>
        ) : null}
        <Button
          title={busy ? say('Submitting…') : say('Submit review')}
          disabled={busy || empty}
          onPress={() => onSubmit(verdict, body.trim())}
        />
      </View>
    </Sheet>
  )
}
