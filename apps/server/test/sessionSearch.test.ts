import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { SessionSearch } from '../src/memory/sessionSearch'

let db: Db, search: SessionSearch
const event = (session: string, seq: number, value: AgentEvent) =>
  db.prepare('INSERT INTO agent_events VALUES (?, ?, ?)').run(session, seq, JSON.stringify(value))
beforeEach(() => {
  db = openDb(':memory:')
  db.exec(`INSERT INTO projects(id,name,created_at) VALUES ('p','Project',1),('q','Other project',1);
    INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES
      ('t','p','Current','current','idle',1),('old','p','Authentication fix','current','idle',1),
      ('elsewhere','q','Other work','current','idle',1),('global','no-project','Global','current','idle',1);
    INSERT INTO agent_sessions(id,task_id,provider,cwd,state,created_at,parent_session_id) VALUES
      ('s','t','codex','/tmp','idle',1,NULL),('past','old','claude-code','/tmp','idle',1,NULL),
      ('other','elsewhere','opencode','/tmp','idle',1,NULL),('global','global','cursor','/tmp','idle',1,NULL),
      ('child','old','codex','/tmp','idle',1,'past');`)
  search = new SessionSearch(db)
})
afterEach(() => db.close())

it('blocks existing search and recall handlers immediately when disabled without deleting history', () => {
  let enabled = true
  const controlled = new SessionSearch(db, () => enabled)
  event('past', 1, { kind: 'text', text: 'Remember authentication decisions' })
  expect(controlled.search('s', 'authentication', 'project', 5, 0).matches).toHaveLength(1)
  enabled = false
  expect(() => controlled.search('s', 'authentication', 'project', 5, 0)).toThrow('turned off')
  expect(() => controlled.recall('s', 'past', 'project', 1, 5)).toThrow('turned off')
  enabled = true
  expect(controlled.recall('s', 'past', 'project', 1, 5).events).toHaveLength(1)
})

it('finds prior decisions across providers with project scope and source links', () => {
  event('past', 1, { kind: 'user', text: 'Fix authentication refresh tokens', at: 42 })
  event('past', 2, { kind: 'text', text: 'Authentication now rotates refresh tokens.' })
  event('other', 1, { kind: 'text', text: 'Authentication in the other project.' })
  event('s', 1, { kind: 'text', text: 'Authentication in the current thread.' })
  const result = search.search('s', 'authentication refresh', 'project', 5, 0)
  expect(result.matches).toHaveLength(2)
  expect(result.matches[0]).toMatchObject({ sessionId: 'past', title: 'Authentication fix', provider: 'claude-code' })
  expect(result.matches[0]!.link).toMatch(/^ramu-thread:old\/past\/[12]$/)
  expect(result.nextOffset).toBeNull()
  expect(search.search('s', 'authentication', 'all', 10, 0).matches).toHaveLength(3)
  expect(() => search.recall('s', 'other', 'project', 1, 5)).toThrow('scope')
  expect(search.recall('s', 'other', 'all', 1, 5).events).toHaveLength(1)
})

it('indexes text content but never reasoning, tools, subagent prose or hidden helper sessions', () => {
  event('past', 1, { kind: 'thinking', text: 'confidential-reasoning' })
  event('past', 2, { kind: 'tool-use', toolUseId: 'x', name: 'shell', summary: 'confidential-tool' })
  event('past', 3, { kind: 'text', text: 'confidential-helper', agentId: 'native-child' })
  event('child', 1, { kind: 'text', text: 'confidential-child' })
  event('past', 4, {
    kind: 'content',
    content: [
      { type: 'text', text: 'Visible authentication decision' },
      { type: 'resource', uri: 'x', name: 'x', text: 'confidential-resource' },
    ],
  })
  expect(search.search('s', 'confidential', 'all', 20, 0).matches).toEqual([])
  expect(search.search('s', 'visible authentication', 'project', 5, 0).matches).toHaveLength(1)
  const recalled = search.recall('s', 'past', 'project', 1, 2)
  expect(recalled.events[0]!.event).toMatchObject({ kind: 'omitted' })
  expect(JSON.stringify(recalled)).not.toContain('confidential-reasoning')
  expect(recalled.nextSeq).toBe(3)
  expect(() => search.recall('s', 'child', 'all', 1, 5)).toThrow('unavailable')
})

it('keeps the index current when streaming messages are updated, replaced, or deleted', () => {
  event('past', 1, { kind: 'text', text: 'obsolete approach' })
  db.prepare('UPDATE agent_events SET event=? WHERE session_id=? AND seq=1').run(
    JSON.stringify({ kind: 'text', text: 'corrected approach' }),
    'past',
  )
  expect(search.search('s', 'obsolete', 'project', 5, 0).matches).toEqual([])
  expect(search.search('s', 'corrected', 'project', 5, 0).matches).toHaveLength(1)
  db.prepare('DELETE FROM agent_events WHERE session_id=?').run('past')
  expect(search.search('s', 'corrected', 'project', 5, 0).matches).toEqual([])
})

it('handles punctuation and unicode as literal search terms and paginates deterministically', () => {
  for (let seq = 1; seq <= 3; seq++) event('past', seq, { kind: 'text', text: 'Perbaiki autentikasi café' })
  const first = search.search('s', '"autentikasi" café', 'project', 2, 0)
  expect(first.matches).toHaveLength(2)
  expect(first.nextOffset).toBe(2)
  const second = search.search('s', '"autentikasi" café', 'project', 2, first.nextOffset!)
  expect(second.matches).toHaveLength(1)
  expect(second.matches[0]!.seq).not.toBe(first.matches[0]!.seq)
  expect(search.search('s', '"*():', 'project', 2, 0).matches).toEqual([])
  expect(search.search('global', 'autentikasi', 'project', 5, 0).matches).toEqual([])
})
