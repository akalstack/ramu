/** What the home-screen widget shows: one page's declared number or short list, and when it was read. */
export interface PageWidgetProps {
  title: string
  page: string
  value: string
  items: string[]
  updatedAt: number
}

export const EMPTY_PAGE_WIDGET: PageWidgetProps = {
  title: 'Ramu',
  page: 'Choose an artifact in Ramu',
  value: '—',
  items: [],
  updatedAt: 0,
}
