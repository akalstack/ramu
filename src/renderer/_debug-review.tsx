import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './src/styles.css'
import './src/ui.css'
const files = [
  {
    id: 'file-a',
    repoId: 'r',
    repoName: 'ramu',
    path: 'src/example.ts',
    status: 'modified',
    binary: false,
    oldContent: 'export function greet() {\n  return "Hello"\n}\n',
    newContent: 'export function greet(name: string) {\n  return `Hello ${name}`\n}\n',
    addedLines: 2,
    removedLines: 2,
  },
  {
    id: 'file-b',
    repoId: 'r',
    repoName: 'ramu',
    path: 'src/another.ts',
    status: 'added',
    binary: false,
    oldContent: '',
    newContent: 'export const enabled = true\n',
    addedLines: 1,
    removedLines: 0,
  },
]
let review = {
  id: 'review',
  taskId: 'chat',
  sessionId: 'session',
  createdAt: Date.now(),
  state: 'ready',
  error: null,
  files,
  comments: [
    {
      id: 'note',
      fileId: 'file-a',
      side: 'new',
      line: 2,
      endLine: 2,
      text: 'Should an empty name receive the default greeting?',
      author: 'ai',
      kind: 'question',
      scope: 'line',
      state: 'draft',
      readyToSend: true,
      createdAt: Date.now(),
    },
  ],
  aiState: 'completed',
  aiSummary: 'THIS SUMMARY SHOULD NOT APPEAR',
}
const handlers = new Map()
const log = []
;(window as any).debugLog = log
;(window as any).debugWorkspace = {
  ui: { activeTaskId: 'chat', sidebar: 'projects' },
  dirty: {},
  task: (id) => ({ id, title: 'Greeting changes' }),
  openTask: () => {},
  openView: (_task, view) => {
    log.push(view)
    window.dispatchEvent(new CustomEvent('debug-open', { detail: view }))
  },
}
;(window as any).ramu = {
  on: (name, callback) => {
    const values = handlers.get(name) || []
    values.push(callback)
    handlers.set(name, values)
    return () => {}
  },
  invoke: async (method, ...args) => {
    log.push({ method, args })
    if (method === 'settings.app.get') return {}
    if (method === 'reviews.list') return [review]
    if (method === 'reviews.get') return review
    if (method === 'reviews.inspect')
      return files.map((f) => ({
        fileId: f.id,
        state: f.id === 'file-a' ? 'changed' : 'unchanged',
        currentPath: f.path,
        outdatedCommentIds: f.id === 'file-a' ? ['note'] : [],
      }))
    if (method === 'reviews.compareCurrent')
      return {
        ...files[0],
        id: 'current',
        oldContent: files[0].newContent,
        newContent: 'export function greet(name: string) {\n  return name ? `Hello ${name}` : "Hello"\n}\n',
        newHash: 'current',
      }
    if (method === 'reviews.select') {
      review = { ...review, comments: review.comments.map((c) => ({ ...c, readyToSend: args[2] })) }
      return review
    }
    if (method === 'reviews.reply') {
      review = {
        ...review,
        comments: review.comments.map((c) => ({
          ...c,
          replies: [{ id: 'reply', text: args[2], author: 'human', state: 'draft', createdAt: Date.now() }],
        })),
      }
      return review
    }
    if (method === 'reviews.sendComments') {
      review = { ...review, comments: review.comments.map((c) => ({ ...c, state: 'sent', readyToSend: false })) }
      return review
    }
    return null
  },
}
const { AppSettingsProvider } = await import('./src/AppSettings')
const { ChangeReviewTab, TurnChanges } = await import('./src/Changes')
function Preview() {
  const [view, setView] = useState({ kind: 'review', id: 'tab', reviewId: 'review', taskId: 'chat' })
  React.useEffect(() => {
    const listener = (e) => {
      if (e.detail.kind === 'review') setView({ ...e.detail, id: 'tab' })
    }
    window.addEventListener('debug-open', listener)
    return () => window.removeEventListener('debug-open', listener)
  }, [])
  return (
    <AppSettingsProvider>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0 16px' }}>
          <TurnChanges review={review} />
        </div>
        <div className="view-tabs">
          <button className="view-tab active">Changes · Greeting changes</button>
        </div>
        <ChangeReviewTab view={view} />
      </div>
    </AppSettingsProvider>
  )
}
createRoot(document.getElementById('root')).render(<Preview />)
