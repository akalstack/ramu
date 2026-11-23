import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from 'cn'
import { Menu } from '../Menu'
import { t } from '../i18n'

/** Which of a stack's sections is open: one at a time, so only one card covers the conversation. */
const OpenSection = createContext<{ open: string | null; setOpen: Dispatch<SetStateAction<string | null>> } | null>(
  null,
)

/** True inside a `TrayStack`, where a section draws itself as a chip. */
export const useInTrayStack = () => useContext(OpenSection) !== null

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

const GAP = 2
/** Room kept for the "+N" chip whenever something does not fit. */
const MORE_WIDTH = 56

/** How many chips fit in `available` pixels, leaving room for the "+N" chip when some must move into it. */
export function chipsThatFit(widths: number[], available: number): number {
  const total = widths.reduce((sum, width, index) => sum + width + (index ? GAP : 0), 0)
  if (total <= available) return widths.length
  let used = 0
  for (let index = 0; index < widths.length; index++) {
    used += widths[index]! + (index ? GAP : 0)
    if (used > available - MORE_WIDTH - GAP) return index
  }
  return widths.length
}

const triggersIn = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>(':scope > .composer-tray-slot')].map((slot) =>
    slot.querySelector<HTMLElement>('.composer-tray-chip-trigger'),
  )

/**
 * Live work and the message queue as one row of chips, like the project and checkout chips on Home and the activity
 * chips on the phone. Everything running stays named in a single line, and a chip opens its card above the row.
 * Chips that do not fit move into a "+N" chip whose menu opens them the same way, so the row never wraps or scrolls.
 */
export function TrayStack({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const sections = Children.toArray(children)
  const row = useRef<HTMLDivElement>(null)
  // A chip moved into "+N" is not laid out, so its last measured width stands in for it.
  const widths = useRef<number[]>([])
  const [fit, setFit] = useState({ shown: Infinity, labels: [] as string[], hiddenOpen: false })
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    const measure = () => {
      const triggers = triggersIn(element)
      triggers.forEach((trigger, index) => {
        if (trigger?.offsetWidth) widths.current[index] = trigger.offsetWidth
      })
      widths.current.length = triggers.length
      const shown = chipsThatFit(widths.current, element.clientWidth)
      const labels = triggers.map((trigger) => (trigger?.textContent ?? '').replace(/·/g, ' · '))
      const hiddenOpen = triggers.some((trigger, index) => index >= shown && trigger?.hasAttribute('data-panel-open'))
      setFit((current) =>
        current.shown === shown && current.hiddenOpen === hiddenOpen && current.labels.join('\n') === labels.join('\n')
          ? current
          : { shown, labels, hiddenOpen },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  })
  if (!sections.length) return null
  const hidden = sections.map((_, index) => index).filter((index) => index >= fit.shown)
  return (
    <OpenSection.Provider value={{ open, setOpen }}>
      <div ref={row} className="composer-tray-stack">
        {sections.map((section, index) => (
          // The section's own key, so a chip leaving the row does not remount the cards after it.
          <div
            key={isValidElement(section) && section.key !== null ? section.key : index}
            className="composer-tray-slot"
            data-overflow={index >= fit.shown || undefined}
          >
            {section}
          </div>
        ))}
        {hidden.length > 0 && (
          <Menu
            label={t('More activity')}
            align="end"
            className={cn('composer-tray-chip-trigger', fit.hiddenOpen && 'on')}
            icon={
              <>
                <MoreHorizontal />
                <span className="composer-tray-title">+{hidden.length}</span>
              </>
            }
            items={hidden.map((index) => ({
              key: String(index),
              label: fit.labels[index] ?? '',
              onSelect: () => {
                const trigger = row.current && triggersIn(row.current)[index]
                if (trigger && !trigger.hasAttribute('data-panel-open')) trigger.click()
              },
            }))}
          />
        )}
      </div>
    </OpenSection.Provider>
  )
}
