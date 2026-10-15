import { useMemo, useState } from 'react'

/** Files marked viewed in a review, remembered per review in localStorage. */
export function useViewedFiles(id: string) {
  const readViewed = (): string[] => {
    try {
      const value = JSON.parse(localStorage.getItem(`ramu.review-viewed:${id}`) ?? '[]')
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }
  const [viewedState, setViewedState] = useState(() => ({ id, files: readViewed() }))
  const viewedFiles = useMemo(
    () => new Set(viewedState.id === id ? viewedState.files : readViewed()),
    [viewedState, id],
  )
  const markViewed = (fileId: string, viewed: boolean) => {
    const next = new Set(viewedFiles)
    viewed ? next.add(fileId) : next.delete(fileId)
    const files = [...next]
    setViewedState({ id, files })
    try {
      localStorage.setItem(`ramu.review-viewed:${id}`, JSON.stringify(files))
    } catch {}
  }
  return { viewedFiles, markViewed }
}
