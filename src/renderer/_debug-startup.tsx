import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './src/styles.css'
import { StartupScreen, Wordmark } from './src/Brand'
function Preview() {
  const [key, setKey] = useState(0)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    const params = new URLSearchParams(location.search)
    const delay = params.has('hold') ? 60000 : params.has('slow') ? 2600 : 30
    const timer = setTimeout(() => setReady(true), delay)
    return () => clearTimeout(timer)
  }, [key])
  return <StartupScreen key={key} ready={ready}><main style={{height:'100%',display:'grid',placeContent:'center',gap:24,textAlign:'center'}}><Wordmark height={48}/><p style={{color:'var(--muted)',margin:0}}>Workspace ready</p><button onClick={() => {setReady(false);setKey(key+1)}}>Replay startup</button></main></StartupScreen>
}
createRoot(document.getElementById('root')!).render(<Preview />)
