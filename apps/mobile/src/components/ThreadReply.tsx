import { useState } from 'react'
import { View } from 'react-native'
import { useSay } from '../i18n'
import { space } from '../theme'
import { CommentField } from './PullRequestComments'
import { Button } from './ui'

/**
 * Answering a review thread on the phone where it is read: Reply opens a box under it, with Reply and resolve beside
 * Reply, and Resolve or Reopen closes or brings back the thread, as on the desktop.
 */
export function ThreadReply({
  resolved,
  resolvable,
  disabled,
  onReply,
  onStatus,
}: {
  resolved: boolean
  resolvable: boolean
  disabled: boolean
  onReply: (body: string) => Promise<boolean>
  onStatus: (resolve: boolean) => Promise<boolean>
}) {
  const say = useSay()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const send = async (andResolve: boolean) => {
    const posted = await onReply(body.trim())
    if (posted && andResolve) await onStatus(true)
    if (posted) {
      setBody('')
      setOpen(false)
    }
  }
  if (!open)
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Button kind="secondary" title={say('Reply')} disabled={disabled} onPress={() => setOpen(true)} />
        {resolvable ? (
          <Button
            kind="ghost"
            title={resolved ? say('Reopen') : say('Resolve')}
            disabled={disabled}
            onPress={() => void onStatus(!resolved)}
          />
        ) : null}
      </View>
    )
  return (
    <View style={{ gap: space.s }}>
      <CommentField
        value={body}
        onChangeText={setBody}
        label={say('Reply to this thread')}
        placeholder={say('Reply. Markdown works.')}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.s }}>
        <Button kind="ghost" title={say('Cancel')} disabled={disabled} onPress={() => setOpen(false)} />
        {resolvable && !resolved ? (
          <Button
            kind="secondary"
            title={say('Reply and resolve')}
            disabled={disabled || !body.trim()}
            onPress={() => void send(true)}
          />
        ) : null}
        <Button title={say('Reply')} disabled={disabled || !body.trim()} onPress={() => void send(false)} />
      </View>
    </View>
  )
}
