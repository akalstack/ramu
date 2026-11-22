import { useCallback, useEffect, useMemo, useState } from 'react'
import { ARTIFACT_SOURCE_FILES, type ArtifactInfo, type ArtifactRecord } from '@ramu/shared/artifacts'
import type { InlineSurface } from '@ramu/shared/chat/inlineUi'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { InlineUiSurface } from '../chat/InlineUiCard'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { errorText } from '../lib/errors'
import { t } from '../i18n'

const RECORD_QUERY = { sort: { field: 'createdAt', direction: 'desc' as const }, limit: 500 }

/** The surface a Card version keeps, or null when its source is missing or unreadable. */
function cardSurfaceOf(document: InteractiveDocument): InlineSurface | null {
  const source = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.card)?.content
  try {
    return source ? (JSON.parse(source) as InlineSurface) : null
  } catch {
    return null
  }
}

/**
 * A Card artifact drawn with the app's own controls instead of a frame. Its collections are read from the host and shown
 * at /records/<collection>; its buttons save and remove records directly, with no model call.
 */
export function CardArtifact({
  page,
  document,
  viewOnly,
}: {
  page: ArtifactInfo
  document: InteractiveDocument
  viewOnly: boolean
}) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const surface = useMemo(() => cardSurfaceOf(document), [document])
  const collections = useMemo(() => Object.keys(page.capabilities.records ?? {}), [page.capabilities.records])
  const allowed = !!page.grants.records
  const [records, setRecords] = useState<Record<string, unknown[]>>({})
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(async () => {
    if (!allowed || !collections.length) return setRecords({})
    try {
      const lists = await Promise.all(
        collections.map(
          (name) =>
            invoke('artifacts.call', page.id, 'records.list', [name, RECORD_QUERY]) as Promise<ArtifactRecord[]>,
        ),
      )
      setRecords(
        Object.fromEntries(
          collections.map((name, index) => [
            name,
            lists[index]!.map((record) => ({ ...record.data, id: record.id, createdAt: record.createdAt })),
          ]),
        ),
      )
      setError(null)
    } catch (reason) {
      setError(errorText(reason))
    }
  }, [allowed, collections, invoke, page.id])
  useEffect(() => {
    void read()
    return on('artifacts:changed', (payload) => {
      if (payload.artifactId === page.id && !payload.run) void read()
    })
  }, [read, on, page.id])
  const extra = useMemo(() => ({ records }), [records])
  if (!surface) return <p className="m-0 p-4 text-muted-foreground">{t('This card could not be read.')}</p>
  return (
    <div className="flex flex-col items-center gap-2 p-4">
      <InlineUiSurface
        surface={surface}
        draftKey={`artifact-card:${page.id}`}
        canAct={!viewOnly && (allowed || !collections.length)}
        extra={extra}
        label={page.title}
        onRequest={async (request) => {
          if (request.kind === 'add') {
            await invoke('artifacts.call', page.id, 'records.add', [request.collection, request.values])
            await read()
            return true
          }
          if (request.kind === 'delete') {
            await invoke('artifacts.call', page.id, 'records.delete', [request.collection, request.id])
            await read()
          }
          return false
        }}
      />
      {error ? (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
