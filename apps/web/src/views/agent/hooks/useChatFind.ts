import { useEffect, useState, type RefObject } from 'react'
import { focusComposer } from '../../../composer/ComposerInput'

/** In-chat find: its open state and query, and the ⌘F command, which opens it in whichever chat is on screen. */
export function useChatFind(root: RefObject<HTMLDivElement | null>) {
  const [finding, setFinding] = useState(false)
  const [findRequest, setFindRequest] = useState(0)
  const [findQuery, setFindQuery] = useState<string | undefined>()
  const openFind = (query?: string) => {
    setFindQuery(query)
    setFinding(true)
    setFindRequest((n) => n + 1)
  }
  const closeFind = () => {
    setFinding(false)
    focusComposer(root.current)
  }
  // ⌘F (the chat.find command) opens find in whichever chat is on screen; hidden panes keep theirs closed.
  useEffect(() => {
    const onFind = (event: Event) => {
      if (root.current?.checkVisibility()) openFind((event as CustomEvent<{ query?: string } | null>).detail?.query)
    }
    window.addEventListener('ramu:find-in-chat', onFind)
    return () => window.removeEventListener('ramu:find-in-chat', onFind)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
  }, [])
  return { finding, findRequest, findQuery, openFind, closeFind }
}
