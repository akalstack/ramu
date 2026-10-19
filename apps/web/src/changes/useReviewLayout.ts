import { useEffect, useState, type RefObject } from 'react'
import { useDiffLayout } from '../git/diffLayout'
import { deviceStorage } from '../deviceStorage'

const NARROW_REVIEW = 720

/** Diff layout and file-tree visibility, remembered in localStorage and adapted to the pane width. */
export function useReviewLayout(root: RefObject<HTMLDivElement | null>, reviewId: string | undefined) {
  const [sideBySide, changeLayout] = useDiffLayout()
  // A docked pane is too narrow for split diffs and a file tree beside them: diffs go inline (the saved choice is kept) and the tree folds away.
  const [narrow, setNarrow] = useState(false)
  const [treeOpen, setTreeOpen] = useState(() => {
      try {
        return deviceStorage.getItem('ramu.review-tree') !== 'closed'
      } catch {
        return true
      }
    }),
    [narrowTree, setNarrowTree] = useState(false)
  const showTree = narrow ? narrowTree : treeOpen
  const toggleTree = () => {
    if (narrow) {
      setNarrowTree(!narrowTree)
      return
    }
    setTreeOpen(!treeOpen)
    try {
      deviceStorage.setItem('ramu.review-tree', treeOpen ? 'closed' : 'open')
    } catch {}
  }
  const split = sideBySide && !narrow
  useEffect(() => {
    const page = root.current,
      bar = page?.querySelector<HTMLElement>('.pair-review-bar')
    if (!page || !bar) return
    let previousHeight = -1
    const measure = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height)
      if (height !== previousHeight) {
        previousHeight = height
        page.style.setProperty('--review-toolbar-height', `${height}px`)
      }
      setNarrow(page.clientWidth < NARROW_REVIEW)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    measure()
    return () => observer.disconnect()
  }, [reviewId])
  return { narrow, split, showTree, toggleTree, changeLayout, closeNarrowTree: () => setNarrowTree(false) }
}
