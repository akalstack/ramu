import { Children, type ReactNode } from 'react'

/**
 * Live work folded under its first card. The first card is the tray's own row; the rest wait in a layer above the tray
 * that only fades in when the person points at it or moves focus into it (see `.composer-tray-spread`). That layer is
 * never part of the layout, so spreading and folding the stack cannot move the conversation.
 */
export function TrayStack({ children }: { children: ReactNode }) {
  const [first, ...rest] = Children.toArray(children)
  if (!first) return null
  return (
    <div className="composer-tray-stack">
      {first}
      {rest.length > 0 && <div className="composer-tray-spread">{rest}</div>}
    </div>
  )
}
