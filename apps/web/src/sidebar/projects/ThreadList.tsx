import { useState, type ReactNode } from 'react'
import { LegendList } from '@legendapp/list/react'
import type { Task } from '@ramu/shared/types'

/** One row of a long sidebar list: a thread, which names its id for range selection, or a heading above some. */
export type ThreadListRow = { key: string; render: () => ReactNode } & ({ taskId: string } | { heading: true })

/** Rows for threads in the identity view's sections, each section's heading above its threads. */
export function sectionRows(
  sections: { key: string; heading: ReactNode; items: Task[] }[],
  render: (task: Task) => ReactNode,
): ThreadListRow[] {
  return sections.flatMap((section) => [
    ...(section.heading
      ? [{ key: `identity:${section.key}`, heading: true as const, render: () => section.heading }]
      : []),
    ...section.items.map((task) => ({ key: task.id, taskId: task.id, render: () => render(task) })),
  ])
}

/** A thread row's usual height; the list measures each row once it is drawn. */
const ROW_PX = 32
const keyOf = (row: ThreadListRow) => row.key
const typeOf = (row: ThreadListRow) => ('heading' in row ? 'heading' : 'thread')

/** The nearest ancestor the sidebar scrolls in; the list draws the rows near its view. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  return null
}

/**
 * Every thread the sidebar lists, in the order it shows them, including the rows a long list has not drawn: a list
 * names all its threads on its own element, and rows outside such lists name themselves.
 */
export function listedThreadIds(): string[] {
  const ids: string[] = []
  for (const element of document.querySelectorAll<HTMLElement>('[data-task-rows], [data-task-row]')) {
    const listed = element.dataset.taskRows
    if (listed !== undefined) ids.push(...(JSON.parse(listed) as string[]))
    else if (!element.parentElement?.closest('[data-task-rows]') && element.dataset.taskId)
      ids.push(element.dataset.taskId)
  }
  return [...new Set(ids)]
}

/**
 * A long list of threads inside the sidebar's one scroll, such as Done or the recent threads, drawn as a virtualized
 * list: only the rows near the view are in the page, so hundreds of threads cost what a screenful does.
 */
export function ThreadList({
  rows,
  footer,
  className,
}: {
  rows: ThreadListRow[]
  footer?: ReactNode
  className?: string
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  // Null until the list is in the page, which the list waits for; with no scrolling ancestor, the window scrolls.
  const scroller = anchor && scrollParent(anchor)
  return (
    <div
      ref={setAnchor}
      className={className}
      data-task-rows={JSON.stringify(rows.flatMap((row) => ('taskId' in row ? [row.taskId] : [])))}
    >
      <LegendList<ThreadListRow>
        scrollElement={anchor && !scroller ? undefined : scroller}
        useWindowScroll={!!anchor && !scroller}
        data={rows}
        keyExtractor={keyOf}
        getItemType={typeOf}
        // The list places rows itself, so the sidebar's 2px between rows, and the room above a heading, are padding.
        renderItem={({ item, index }) => (
          <div className={index ? ('heading' in item ? 'pt-2.5' : 'pt-0.5') : undefined}>{item.render()}</div>
        )}
        estimatedItemSize={ROW_PX}
        ListFooterComponent={footer ? <div className="pt-0.5">{footer}</div> : undefined}
      />
    </div>
  )
}
