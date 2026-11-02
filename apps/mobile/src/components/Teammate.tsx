import { useState } from 'react'
import { View } from 'react-native'
import type { AgentSettings, AgentTask, TeammateMode } from '@ramu/shared/types'
import { activeTeammate } from '@ramu/shared/chat/agentTasks'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, space } from '../theme'
import { ModelChip, type ModelChoice } from './Composer'
import { TextField } from './ScheduleFields'
import { Button, Segmented, Sheet, T } from './ui'

/** The thread's teammate, read from its helper cards; the newest card for each helper wins. */
export function teammateOf(chat: Chat): AgentTask | undefined {
  const cards = new Map<string, AgentTask>()
  for (const item of chat.items)
    if (item.kind === 'agents') for (const agent of item.agents) cards.set(agent.agentId, agent)
  return activeTeammate([...cards.values()])
}

/** The phone's Add teammate: a model, Review or Take over, and an optional request. */
export function AddTeammateSheet({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const say = useSay()
  const store = useStore()
  const base = chat.settings
  const [model, setModel] = useState<ModelChoice>({
    provider: chat.provider,
    model: chat.model,
    effort: chat.effort,
  })
  const [mode, setMode] = useState<TeammateMode>('review')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const add = async () => {
    if (!chat.sessionId || !base) return
    setBusy(true)
    setError('')
    try {
      const settings: AgentSettings = {
        ...base,
        provider: model.provider,
        model: model.model,
        effort: (model.effort || null) as AgentSettings['effort'],
      }
      await store.invoke(chat.computerId, 'agent.addTeammate', chat.sessionId, settings, mode, request)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={say('Add teammate')}>
      <View style={{ padding: space.l, gap: space.m }}>
        <T size={font.caption} tone="muted">
          {say('A second model joins this thread with the conversation so far, and keeps its own session.')}
        </T>
        <ModelChip value={model} computerId={chat.computerId} onChange={setModel} />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { key: 'review', label: say('Review') },
            { key: 'take-over', label: say('Take over') },
          ]}
        />
        <T size={font.caption} tone="muted">
          {mode === 'review'
            ? say('Reads the latest changes and replies with findings. It never edits, whatever this thread allows.')
            : say('Edits while the lead waits, then hands back with a summary.')}
        </T>
        <TextField multiline placeholder={say('What should it do?')} value={request} onChangeText={setRequest} />
        {error ? (
          <T size={font.caption} tone="bad">
            {error}
          </T>
        ) : null}
        <Button title={say('Add teammate')} disabled={busy || !chat.sessionId} onPress={() => void add()} />
      </View>
    </Sheet>
  )
}
