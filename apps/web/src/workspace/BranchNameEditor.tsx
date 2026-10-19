import { useCallback, useEffect, useRef, useState } from 'react'
import { validBranchName, type BranchChoice, type BranchNamingIntent } from '@ramu/shared/workspaceDefaults'
import { Input } from '@/components/desktop-input'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'
import { useHost } from './HostProvider'
import { errorText } from './TaskPane'

export function BranchNameEditor({
  projectId: projectScope,
  title,
  intent,
  choice,
  onChange,
  busy,
}: {
  projectId: string
  title: string
  intent: BranchNamingIntent
  choice?: BranchChoice
  onChange: (choice?: BranchChoice) => void
  busy: boolean
}) {
  const { invoke } = useHost()
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const epoch = useRef(0)
  const pending = useRef<string | null>(null)
  const cancel = useCallback(() => {
    epoch.current++
    const requestId = pending.current
    pending.current = null
    if (requestId) void invoke('tasks.cancelBranch', requestId).catch(() => {})
  }, [invoke])
  const intentKey = JSON.stringify([intent, title])
  useEffect(() => {
    cancel()
    setGenerating(false)
    setError(null)
    return () => {
      cancel()
    }
  }, [intentKey, projectScope, cancel])
  useEffect(() => {
    if (busy) {
      cancel()
      setGenerating(false)
    }
  }, [busy, cancel])
  return (
    <div className="space-y-2">
      <label className="block">
        {t('Branch name')}
        <Input
          aria-label={t('Branch name')}
          maxLength={160}
          disabled={busy}
          value={choice?.name ?? ''}
          placeholder={t('Automatic branch name')}
          aria-invalid={!!choice && !validBranchName(choice.name)}
          onChange={(event) => {
            cancel()
            setGenerating(false)
            setError(null)
            onChange(event.target.value ? { name: event.target.value, source: 'manual' } : undefined)
          }}
        />
      </label>
      {intent.strategy !== 'fixed' && (
        <>
          {!choice && (
            <p>{t('Preview is provisional until a name is generated. Sending generates a name automatically.')}</p>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || generating || !title}
            onClick={async () => {
              const token = ++epoch.current
              const requestId = crypto.randomUUID()
              pending.current = requestId
              setGenerating(true)
              setError(null)
              try {
                const result = await invoke('tasks.generateBranch', projectScope, title, intent, requestId)
                if (token === epoch.current) onChange(result)
              } catch (cause) {
                if (token === epoch.current) setError(errorText(cause))
              } finally {
                if (token === epoch.current) {
                  pending.current = null
                  setGenerating(false)
                }
              }
            }}
          >
            {t(generating ? 'Generating…' : 'Generate name')}
          </Button>
          {generating && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                cancel()
                setGenerating(false)
              }}
            >
              {t('Cancel')}
            </Button>
          )}
        </>
      )}
      {choice?.source === 'fallback' && <p role="status">{t('Used default branch name')}</p>}
      {error && (
        <p role="alert" className="text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
