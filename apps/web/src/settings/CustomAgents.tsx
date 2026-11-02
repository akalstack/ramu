import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { customAgentHandle, type CustomAgent } from '@ramu/shared/customAgents'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { Textarea } from '@/components/ui/textarea'
import { AgentControls } from '../chat/AgentControls'
import { notifyError } from '../chat/Notifications'
import { useViewOnly } from '../composer/useViewOnly'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useModelSets } from '../models/ModelSets'
import { useHost } from '../workspace/HostProvider'

type Draft = Omit<CustomAgent, 'id' | 'updatedAt'> & { id?: string }

function Editor({ draft, onSaved, onCancel }: { draft: Draft; onSaved: () => void; onCancel: () => void }) {
  const { invoke } = useHost()
  const { initialSettings } = useModelSets()
  const [value, setValue] = useState(draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('customAgents.save', value)
      onSaved()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-(--radius-m) bg-fill p-3">
      <Input
        aria-label={t('Name')}
        value={value.name}
        maxLength={60}
        onChange={(event) => setValue({ ...value, name: event.target.value })}
      />
      <Input
        aria-label={t('When to use it')}
        placeholder={t('When to use it')}
        value={value.description}
        maxLength={300}
        onChange={(event) => setValue({ ...value, description: event.target.value })}
      />
      <Textarea
        rows={5}
        aria-label={t('Instructions')}
        placeholder={t('Instructions')}
        value={value.instructions}
        maxLength={8000}
        onChange={(event) => setValue({ ...value, instructions: event.target.value })}
      />
      <label className="flex items-center gap-2 text-control">
        <Checkbox
          checked={!!value.model}
          onCheckedChange={(checked) =>
            setValue({
              ...value,
              model: checked
                ? { provider: initialSettings.provider, model: initialSettings.model, effort: initialSettings.effort }
                : null,
            })
          }
        />
        {t('Run on a chosen model instead of sub-agent routing')}
      </label>
      {value.model && (
        <AgentControls
          settings={{ ...initialSettings, ...value.model }}
          onChange={(next) =>
            setValue({ ...value, model: { provider: next.provider, model: next.model, effort: next.effort } })
          }
          disabled={busy}
        />
      )}
      <label className="flex items-center gap-2 text-control">
        <Checkbox checked={value.readOnly} onCheckedChange={(checked) => setValue({ ...value, readOnly: !!checked })} />
        {t('Read-only: it can read and report, never edit')}
      </label>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button
          size="sm"
          disabled={busy || !value.name.trim() || !value.description.trim() || !value.instructions.trim()}
          onClick={() => void save()}
        >
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}

/** Settings › Custom agents: describe one in a sentence, review the draft, save it. The lead uses them when a task fits. */
export function CustomAgentSettings() {
  useLanguage()
  const { invoke } = useHost()
  const viewOnly = useViewOnly()
  const { initialSettings } = useModelSets()
  const [agents, setAgents] = useState<CustomAgent[]>([])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [sentence, setSentence] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () => invoke('customAgents.list').then(setAgents, (cause) => setError(errorText(cause))),
    [invoke],
  )
  useEffect(() => {
    void reload()
  }, [reload])
  const draft = async () => {
    setDrafting(true)
    setError(null)
    try {
      const drafted = await invoke('customAgents.draft', sentence, initialSettings)
      setEditing({ ...drafted, model: null })
      setSentence('')
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setDrafting(false)
    }
  }
  return (
    <section className="flex flex-col gap-2" aria-label={t('Custom agents')}>
      <SettingsGroupTitle>{t('Custom agents')}</SettingsGroupTitle>
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Reusable agents for sub-agents to use. The thread’s agent sees each description and uses one when a task fits; the thread shows which ran. A custom agent wins over a sub-agent type of the same name.',
        )}
      </p>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void draft()
        }}
      >
        <Input
          aria-label={t('Describe a new agent')}
          placeholder={t('A strict reviewer for security and missing tests')}
          maxLength={2000}
          value={sentence}
          disabled={viewOnly || drafting}
          onChange={(event) => setSentence(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={viewOnly || drafting || sentence.trim().length < 3}
        >
          <Plus size={13} />
          {drafting ? t('Drafting…') : t('New agent')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {editing && (
        <Editor
          key={editing.id ?? 'new'}
          draft={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}
      {agents.map((agent) => (
        <div key={agent.id} className="flex items-center gap-2 py-1">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-body">{customAgentHandle(agent.name)}</p>
            <p className="m-0 truncate text-caption text-muted-foreground">
              {[agent.description, agent.readOnly ? t('Read-only') : '', agent.model?.model ?? '']
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('Edit {0}', { 0: agent.name })}
            disabled={viewOnly}
            onClick={() => setEditing(agent)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('Remove {0}', { 0: agent.name })}
            disabled={viewOnly}
            onClick={() =>
              void invoke('customAgents.delete', agent.id).then(reload, (cause) => notifyError(errorText(cause)))
            }
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
    </section>
  )
}
