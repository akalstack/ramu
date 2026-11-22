import { LiveWindowView } from './liveView/LiveView'
import { chatMotionVariables } from '@ramu/shared/chat/presentation'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@xterm/xterm/css/xterm.css'
import './ui.css'
import './styles.css'
import './chat.css'
import './motion.css'
import './git-panel.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { monaco } from './editor/monaco'
import { createRoot } from 'react-dom/client'
import { errorText, isOfflineError } from './lib/errors'
import { useCallback, useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, invalidateDataOn } from './dataQueries'
import { bridge } from './ipc'
import { ownHostId } from './hosts'
import { pruneDrafts } from './composer/drafts'
import { installAppearance } from './appearance'
import { installTheme } from './theme/themes'
import { installEditorTheme } from './editor/customEditorTheme'
import { App } from './App'
import { HostProvider } from './workspace/HostProvider'
import { StartupScreen } from './Brand'
import { ErrorBoundary } from './ErrorBoundary'

for (const [name, value] of Object.entries(chatMotionVariables)) document.documentElement.style.setProperty(name, value)

function Startup() {
  const [fontsReady, setFontsReady] = useState(false)
  const [appReady, setAppReady] = useState(false)
  const onReady = useCallback(() => setAppReady(true), [])
  useEffect(() => {
    let disposed = false
    void Promise.all([
      document.fonts.load('13px "Geist Variable"'),
      document.fonts.load('600 13px "Geist Variable"'),
      document.fonts.load('13px "Geist Mono Variable"'),
    ])
      .catch(() => undefined)
      .then(() => {
        if (disposed) return
        monaco.editor.remeasureFonts()
        setFontsReady(true)
      })
    return () => {
      disposed = true
    }
  }, [])
  useEffect(() => {
    // Every host's cached reads go stale on that host's own events (this window may show several hosts' stores).
    const host = (from?: string) => from ?? ownHostId()
    const offs = [
      bridge.on('fs:changed', (_, from) => {
        void invalidateDataOn(host(from), 'files', 'git')
      }),
      bridge.on('automation:changed', (_, from) => {
        void invalidateDataOn(host(from), 'reviews', 'tasks')
      }),
      bridge.on('agent:event', (_, from) => {
        void invalidateDataOn(host(from), 'agent')
      }),
      bridge.on('background:connection', ({ connected }, from) => {
        if (connected) void invalidateDataOn(host(from))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])
  return (
    <StartupScreen ready={fontsReady && appReady}>
      <ErrorBoundary scope="app">
        <HostProvider>
          <TooltipProvider delay={350}>
            <App onReady={onReady} />
          </TooltipProvider>
        </HostProvider>
      </ErrorBoundary>
    </StartupScreen>
  )
}

installAppearance()
installTheme()
installEditorTheme()

// A call made in the background to a host that went offline (lost, timed out, never sent) is expected, not a crash:
// the views show the host as offline and read again on reconnect. Anything else stays an unhandled rejection.
window.addEventListener('unhandledrejection', (event) => {
  if (isOfflineError(event.reason)) {
    event.preventDefault()
    console.warn('A call to an offline host was dropped:', errorText(event.reason))
  }
})

// Fonts and application data load behind one continuous logo-to-wordmark reveal.
if (new URLSearchParams(location.search).has('live')) {
  // The live view window: one thread's view and Stop, nothing else of the workspace.
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary scope="app">
        <LiveWindowView />
      </ErrorBoundary>
    </QueryClientProvider>,
  )
} else {
  pruneDrafts()
  createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
      <Startup />
    </QueryClientProvider>,
  )
}
