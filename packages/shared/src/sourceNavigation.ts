import type { TaskUiState } from './types'

/** Message jump targets are navigation requests, never saved chat state. */
export function persistentTaskUi(state: TaskUiState): TaskUiState {
  return {
    ...state,
    views: state.views.map((view) => {
      if (view.kind !== 'agent') return view
      const { sourceSeq: _seq, sourceRequestId: _request, ...rest } = view
      return rest
    }),
  }
}

export function highlightSource(
  node: { classList: { add(name: string): void; remove(name: string): void } },
  consume: () => void,
) {
  let cleared = false
  node.classList.add('recap-source-highlight')
  const clear = () => {
    if (cleared) return
    cleared = true
    clearTimeout(timer)
    node.classList.remove('recap-source-highlight')
    consume()
  }
  const timer = setTimeout(clear, 4000)
  return clear
}
