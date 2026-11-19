import {
  Children,
  createContext,
  Fragment,
  useContext,
  useId,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { ChevronUp } from 'lucide-react'

/** One kind of live work in a folded stack's summary, such as "Browser 1". */
export interface TrayStackItem {
  key: string
  icon: ReactNode
  label: string
  count?: number
}

/** Which of a stack's sections is open: one at a time, so the spread never grows over the conversation. */
const OpenSection = createContext<{ open: string | null; setOpen: Dispatch<SetStateAction<string | null>> } | null>(
  null,
)

/**
 * A tray section's open state. Inside a `TrayStack`, opening one closes the one open before; elsewhere each section
 * keeps its own.
 */
export function useTraySection(initial = false): [boolean, (open: boolean) => void] {
  const group = useContext(OpenSection)
  const id = useId()
  const [own, setOwn] = useState(initial)
  if (!group) return [own, setOwn]
  return [group.open === id, (open) => group.setOpen((current) => (open ? id : current === id ? null : current))]
}

/**
 * Live work folded under its first card. The first card is the tray's own row; the rest wait in a layer above the tray
 * that only fades in when the person points at it or moves focus into it (see `.composer-tray-spread`). That layer is
 * never part of the layout, so spreading and folding the stack cannot move the conversation.
 *
 * Folded with more than one kind of work, the row names all of them rather than only the first, so nothing running is
 * out of sight; pointing at the tray, or focusing the card under the summary, spreads the stack.
 */
export function TrayStack({ children, summary }: { children: ReactNode; summary: TrayStackItem[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [first, ...rest] = Children.toArray(children)
  if (!first) return null
  return (
    <OpenSection.Provider value={{ open, setOpen }}>
      <div className="composer-tray-stack">
        <div className="composer-tray-first">
          {first}
          {rest.length > 0 && summary.length > 1 && (
            // Only a picture of the stack: the cards under it keep their controls for focus and screen readers.
            <div aria-hidden className="composer-tray-summary">
              {summary.map((item, index) => (
                <Fragment key={item.key}>
                  {index > 0 && <span className="composer-tray-count-dot">·</span>}
                  <span className="composer-tray-summary-item">
                    {item.icon}
                    {item.label}
                    {item.count !== undefined && <span className="composer-tray-count">{item.count}</span>}
                  </span>
                </Fragment>
              ))}
              <ChevronUp className="composer-tray-chevron ml-auto" />
            </div>
          )}
        </div>
        {rest.length > 0 && <div className="composer-tray-spread">{rest}</div>}
      </div>
    </OpenSection.Provider>
  )
}
