import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@xterm/xterm/css/xterm.css'
import './ui.css'
import './styles.css'
import './chat.css'
import './motion.css'
import './git-panel.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { monaco } from './monaco'
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, invalidateData } from './dataQueries'
import { ramu } from './ipc'
import { pruneDrafts } from './drafts'
import { App } from './App'
import { StartupScreen } from './Brand'
import { ErrorBoundary } from './ErrorBoundary'

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
    ]).catch(() => undefined).then(() => {
      if (disposed) return
      monaco.editor.remeasureFonts()
      setFontsReady(true)
    })
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    const offs = [
      ramu.on('fs:changed', () => { void invalidateData('files', 'git') }),
      ramu.on('automation:changed', () => { void invalidateData('reviews', 'tasks') }),
      ramu.on('agent:event', () => { void invalidateData('agent') }),
      ramu.on('background:connection', ({ connected }) => { if (connected) void invalidateData() }),
    ]
    return () => offs.forEach(off => off())
  }, [])
  return <StartupScreen ready={fontsReady && appReady}><ErrorBoundary scope="app"><TooltipProvider delay={350}><App onReady={onReady} /></TooltipProvider></ErrorBoundary></StartupScreen>
}

// Fonts and application data load behind one continuous logo-to-wordmark reveal.
pruneDrafts()
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Startup /></QueryClientProvider>)
