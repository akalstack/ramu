import { beginPaneResize as begin } from '../../shared/paneResize'

export function beginPaneResize(event: { button: number; pointerId: number; currentTarget: Element; preventDefault(): void }, axis: 'column' | 'row', move: (event: { clientX: number; clientY: number }) => void, finish?: () => void): () => void {
  return begin(event, axis, { surface: window, body: document.body }, move, finish)
}
