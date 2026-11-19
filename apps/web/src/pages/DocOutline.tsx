import type { RefObject } from 'react'
import { ListTree } from 'lucide-react'
import { GHOST_ICON_BUTTON_CLASS } from '../components/button-classes'
import { Menu } from '../Menu'
import { t } from '../i18n'

export interface OutlineHeading {
  id: string
  text: string
  level: number
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name]!)

/** A drawn doc's headings with the anchors the host gave them, in reading order. */
export function docOutline(html: string): OutlineHeading[] {
  return [...html.matchAll(/<h([1-6]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].flatMap(([, level, id, inner]) => {
    const text = decode(inner!.replace(/<[^>]*>/g, '')).trim()
    return text ? [{ id: decode(id!), text, level: Number(level) }] : []
  })
}

/** Jumps the doc in the artifact's frame to one of its headings. */
export function DocOutline({
  frame,
  instance,
  headings,
  disabled,
}: {
  frame: RefObject<HTMLIFrameElement | null>
  instance: string
  headings: OutlineHeading[]
  disabled: boolean
}) {
  const top = Math.min(...headings.map((heading) => heading.level))
  return (
    <Menu
      label={t('Outline')}
      icon={<ListTree size={14} />}
      className={GHOST_ICON_BUTTON_CLASS}
      align="end"
      disabled={disabled}
      menuClassName="max-h-[60vh] overflow-y-auto"
      items={headings.map((heading, index) => ({
        key: `${index}:${heading.id}`,
        title: heading.text,
        label: (
          <span className="block max-w-72 truncate" style={{ paddingInlineStart: `${(heading.level - top) * 12}px` }}>
            {heading.text}
          </span>
        ),
        onSelect: () =>
          frame.current?.contentWindow?.postMessage(
            { ramuInteractive: 1, instance, type: 'heading', value: { id: heading.id } },
            '*',
          ),
      }))}
    />
  )
}
