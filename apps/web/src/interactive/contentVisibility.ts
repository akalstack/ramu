/** Keep in-memory playback when the window hides, but release offscreen documents and their resource leases. */
export function observeContentVisibility(
  root: Element,
  document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
  callbacks: { visible(): void; hidden(): void; active(value: boolean): void },
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onScreen = false
  const update = () => {
    clearTimeout(timer)
    callbacks.active(onScreen && !document.hidden)
    if (onScreen) {
      callbacks.visible()
    } else {
      timer = setTimeout(callbacks.hidden, 150)
    }
  }
  const observer = new IntersectionObserver(
    ([entry]) => {
      onScreen = !!entry?.isIntersecting
      update()
    },
    { rootMargin: '500px' },
  )
  observer.observe(root)
  document.addEventListener('visibilitychange', update)
  return () => {
    observer.disconnect()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', update)
  }
}
