/** One active grab handle; cancellation and window blur also finish the drag. */
type Classes = { add(value: string): void; remove(value: string): void }
type ResizePointer = Event & { pointerId: number; clientX: number; clientY: number }
export function beginPaneResize(event: { button: number; pointerId: number; currentTarget: { classList: Classes }; preventDefault(): void }, axis: 'column' | 'row', environment: { surface: EventTarget; body: { classList: Classes } }, move: (event: ResizePointer) => void, finish: () => void = () => {}): () => void {
  if (event.button !== 0) return () => {}
  event.preventDefault()
  const handle = event.currentTarget
  const { surface, body } = environment
  const cursor = axis === 'column' ? 'resizing' : 'resizing-terminal'
  let ended = false
  const onMove = (next: Event) => { const pointer = next as ResizePointer; if (pointer.pointerId === event.pointerId) move(pointer) }
  const end = () => {
    if (ended) return
    ended = true
    surface.removeEventListener('pointermove', onMove)
    surface.removeEventListener('pointerup', onUp)
    surface.removeEventListener('pointercancel', onUp)
    surface.removeEventListener('blur', end)
    handle.classList.remove('is-resizing')
    body.classList.remove(cursor)
    finish()
  }
  const onUp = (next: Event) => { if ((next as ResizePointer).pointerId === event.pointerId) end() }
  handle.classList.add('is-resizing')
  body.classList.add(cursor)
  surface.addEventListener('pointermove', onMove)
  surface.addEventListener('pointerup', onUp)
  surface.addEventListener('pointercancel', onUp)
  surface.addEventListener('blur', end)
  return end
}
