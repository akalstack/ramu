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
import { App } from './App'
import { StartupScreen } from './Brand'

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
  return <StartupScreen ready={fontsReady && appReady}><TooltipProvider delay={350}><App onReady={onReady} /></TooltipProvider></StartupScreen>
}

// Fonts and application data load behind one continuous logo-to-wordmark reveal.
createRoot(document.getElementById('root')!).render(<Startup />)
