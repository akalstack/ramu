import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import { providerName } from '@ramu/shared/providers/providers'
import type { SharedMcpManagement } from '@ramu/shared/mcp'
import type { Memory, SkillInfo } from '@ramu/shared/types'
import { matchesWords, searchWords } from '@ramu/shared/listView'
import { useStore } from '../runtime/store'
import { space, useTheme } from '../theme'
import { BottomSearch } from './BottomSearch'
import { Button, Card, Chip, Divider, Row, SectionLabel, T } from './ui'
import { RowLabel } from './SettingRows'

const STATUS_LABEL: Record<SharedMcpManagement['connections'][number]['status'], string> = {
  disabled: 'Off',
  'not-connected': 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  failed: 'Failed',
  unsupported: 'Unsupported',
  'sign-in-required': 'Sign-in required',
  'insufficient-permission': 'Insufficient permission',
}

/** The host project id behind a phone project id (`<host>:<project>`). */
const hostProjectId = (id: string) => id.slice(id.indexOf(':') + 1)

/**
 * What agents on a host start with beyond the prompt: the skills a project's threads can use and the MCP servers Ramu
 * shares with them. Adding servers, signing in and approving tools stay on the host, which holds the credentials.
 */
export function AgentSetupSettings({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const online = store.isOnline(hostId)
  const projects = store.projects.filter((project) => project.computerId === hostId)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [mcp, setMcp] = useState<SharedMcpManagement | null>(null)
  const [error, setError] = useState('')
  const runtime = useRef(store)
  runtime.current = store
  useEffect(() => {
    if (!online) return
    let active = true
    const read = () =>
      void runtime.current.invoke(hostId, 'mcp.status').then(
        (status) => active && setMcp(status),
        (reason: unknown) => active && setError(reason instanceof Error ? reason.message : String(reason)),
      )
    read()
    const unsubscribe = runtime.current.subscribe(hostId, (channel) => {
      if (channel === 'mcp:changed') read()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [hostId, online])
  useEffect(() => {
    setSkills(null)
    if (!online || !projectId) return
    let active = true
    void runtime.current.invoke(hostId, 'skills.list', `project:${hostProjectId(projectId)}`).then(
      (list) => active && setSkills([...list].sort((a, b) => a.name.localeCompare(b.name))),
      () => active && setSkills([]),
    )
    return () => {
      active = false
    }
  }, [hostId, online, projectId])
  return (
    <View style={{ gap: space.s, paddingBottom: space.l }}>
      {!online ? (
        <T tone="muted" style={{ paddingHorizontal: space.l }}>
          {t('Reconnect to use these controls.')}
        </T>
      ) : null}
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l }}>
          {error}
        </T>
      ) : null}
      <SectionLabel>{t('MCP servers')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {!mcp && online && !error ? <ActivityIndicator color={c.accent} style={{ padding: space.m }} /> : null}
        {mcp && !mcp.connections.length && !mcp.providerManaged?.length ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel title={t('No shared servers yet')} help={t('Add one in Settings → Agent setup on the host.')} />
          </Row>
        ) : null}
        {mcp?.connections.map(({ connection, status, reason, toolCount }, index) => (
          <View key={connection.id}>
            {index ? <Divider inset={space.l} /> : null}
            <Row style={{ paddingVertical: space.m }}>
              <RowLabel
                title={connection.name}
                help={[
                  t(STATUS_LABEL[status]),
                  toolCount != null ? t('{count} tools', { count: toolCount }) : null,
                  connection.providers.map(providerName).join(', '),
                  reason ?? null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </Row>
          </View>
        ))}
        {mcp?.providerManaged?.map((server, index) => (
          <View key={`${server.provider}:${server.name}`}>
            {index || mcp.connections.length ? <Divider inset={space.l} /> : null}
            <Row style={{ paddingVertical: space.m }}>
              <RowLabel
                title={server.name}
                help={t('Only {provider} has it, from its own settings', { provider: providerName(server.provider) })}
              />
            </Row>
          </View>
        ))}
      </Card>
      <T size={13} tone="muted" style={{ paddingHorizontal: space.l }}>
        {t('Adding servers, signing in and approving their tools happen on the host, which keeps the credentials.')}
      </T>
      <SectionLabel>{t('Skills')}</SectionLabel>
      {projects.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingHorizontal: space.l }}>
          {projects.map((project) => (
            <Chip
              key={project.id}
              label={project.name}
              selected={project.id === projectId}
              small
              onPress={() => setProjectId(project.id)}
            />
          ))}
        </View>
      ) : null}
      <Card style={{ marginHorizontal: space.l }}>
        {projectId && skills === null && online ? (
          <ActivityIndicator color={c.accent} style={{ padding: space.m }} />
        ) : null}
        {!projectId || (skills && !skills.length) ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel
              title={t('No skills found')}
              help={t('Skills in a project or your provider folders show here.')}
            />
          </Row>
        ) : null}
        {skills?.map((skill, index) => (
          <View key={skill.name}>
            {index ? <Divider inset={space.l} /> : null}
            <Row style={{ paddingVertical: space.m }}>
              <RowLabel title={skill.name} help={skill.description} />
            </Row>
          </View>
        ))}
      </Card>
    </View>
  )
}

/** What agents remember on a host: search it, read an entry, and archive or restore it. */
export function MemoryList({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const online = store.isOnline(hostId)
  const owner = store.computers.find((computer) => computer.id === hostId)?.access !== 'viewer'
  const [memories, setMemories] = useState<Memory[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const runtime = useRef(store)
  runtime.current = store
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!online) return
    let active = true
    void runtime.current.invoke(hostId, 'memory.get').then(
      (snapshot) => active && setMemories(snapshot.memories),
      () => active && setMemories([]),
    )
    const unsubscribe = runtime.current.subscribe(hostId, (channel) => {
      if (channel === 'memory:changed') setReload((value) => value + 1)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [hostId, online, reload])
  const words = searchWords(query)
  const shown = (memories ?? [])
    .filter((memory) => (memory.status === 'archived') === archived)
    .filter((memory) => matchesWords(`${memory.title} ${memory.content} ${memory.tags.join(' ')}`, words))
    .sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title))
  const act = (memory: Memory) => {
    const method = memory.status === 'archived' ? 'memory.restore' : 'memory.archive'
    void runtime.current.invoke(hostId, method, memory.id).then(
      () => setReload((value) => value + 1),
      (reason: unknown) => Alert.alert(reason instanceof Error ? reason.message : String(reason)),
    )
  }
  return (
    <View style={{ gap: space.s, paddingBottom: space.l }}>
      <SectionLabel
        right={
          <Chip
            label={archived ? t('Archived') : t('Active')}
            small
            selected={archived}
            onPress={() => setArchived((value) => !value)}
          />
        }
      >
        {t('Memories')}
      </SectionLabel>
      <View style={{ paddingHorizontal: space.l }}>
        <BottomSearch value={query} onChangeText={setQuery} placeholder={t('Search memories')} />
      </View>
      <Card style={{ marginHorizontal: space.l }}>
        {memories === null && online ? <ActivityIndicator color={c.accent} style={{ padding: space.m }} /> : null}
        {memories && !shown.length ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel title={archived ? t('Nothing archived') : t('No memories yet')} />
          </Row>
        ) : null}
        {shown.slice(0, 100).map((memory, index) => (
          <View key={memory.id}>
            {index ? <Divider inset={space.l} /> : null}
            <Row
              style={{ paddingVertical: space.m, flexDirection: 'column', alignItems: 'stretch', gap: space.s }}
              onPress={() => setOpen((current) => (current === memory.id ? null : memory.id))}
              accessibilityState={{ expanded: open === memory.id }}
            >
              <RowLabel title={memory.title} help={memory.tags.length ? memory.tags.join(', ') : undefined} />
              {open === memory.id ? (
                <>
                  <T size={14} tone="muted" selectable>
                    {memory.content}
                  </T>
                  {owner ? (
                    <View style={{ flexDirection: 'row' }}>
                      <Button
                        kind="secondary"
                        title={memory.status === 'archived' ? t('Restore') : t('Archive')}
                        disabled={!online}
                        onPress={() => act(memory)}
                      />
                    </View>
                  ) : null}
                </>
              ) : null}
            </Row>
          </View>
        ))}
      </Card>
    </View>
  )
}
