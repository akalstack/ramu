import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView } from 'react-native'
import { ARTIFACT_SOURCE_FILES, type ArtifactInfo, type ArtifactRecord } from '@ramu/shared/artifacts'
import type { InlineSurface } from '@ramu/shared/chat/inlineUi'
import type { InteractiveDocument } from '@ramu/shared/interactive'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { font, space } from '../theme'
import { InlineUiSurface } from './InlineUiCard'
import { T } from './ui'

const RECORD_QUERY = { sort: { field: 'createdAt', direction: 'desc' as const }, limit: 500 }

/**
 * A Card artifact on the phone, drawn with the app's own controls instead of a private browser. Its collections are read
 * from the host at /records/<collection>, and its buttons save and remove records directly, with no model call.
 */
export function CardArtifact({
  computerId,
  page,
  document,
}: {
  computerId: string
  page: ArtifactInfo
  document: InteractiveDocument
}) {
  const store = useStore()
  const say = useSay()
  const surface = useMemo(() => {
    const source = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.card)?.content
    try {
      return source ? (JSON.parse(source) as InlineSurface) : null
    } catch {
      return null
    }
  }, [document])
  const collections = useMemo(() => Object.keys(page.capabilities.records ?? {}), [page.capabilities.records])
  const allowed = !!page.grants.records
  const viewer = store.computers.find((host) => host.id === computerId)?.access === 'viewer'
  const [records, setRecords] = useState<Record<string, unknown[]>>({})
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(async () => {
    if (!allowed || !collections.length) return setRecords({})
    try {
      const lists = (await Promise.all(
        collections.map((name) =>
          store.invoke(computerId, 'artifacts.call', page.id, 'records.list', [name, RECORD_QUERY]),
        ),
      )) as ArtifactRecord[][]
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
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [allowed, collections, computerId, page.id]; the store's invoke is stable for a host
  }, [allowed, collections, computerId, page.id])
  useEffect(() => {
    void read()
    return store.subscribe(computerId, (...[channel, payload]) => {
      if (channel !== 'artifacts:changed') return
      const event = payload as { artifactId: string; run?: unknown }
      if (event.artifactId === page.id && !event.run) void read()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resubscribes on [read, computerId, page.id]; the store's subscribe is stable for a host
  }, [read, computerId, page.id])
  const extra = useMemo(() => ({ records }), [records])
  if (!surface)
    return (
      <T tone="muted" style={{ padding: space.l }}>
        {say('This card could not be read.')}
      </T>
    )
  return (
    <ScrollView contentContainerStyle={{ padding: space.m, gap: space.s }} keyboardShouldPersistTaps="handled">
      <InlineUiSurface
        surface={surface}
        draftKey={`${computerId}:artifact-card:${page.id}`}
        canAct={!viewer && (allowed || !collections.length)}
        extra={extra}
        label={page.title}
        onRequest={async (request) => {
          if (request.kind === 'add') {
            await store.invoke(computerId, 'artifacts.call', page.id, 'records.add', [
              request.collection,
              request.values,
            ])
            await read()
            return true
          }
          if (request.kind === 'delete') {
            await store.invoke(computerId, 'artifacts.call', page.id, 'records.delete', [
              request.collection,
              request.id,
            ])
            await read()
          }
          return false
        }}
      />
      {error ? (
        <T size={font.caption} tone="bad" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : null}
    </ScrollView>
  )
}
