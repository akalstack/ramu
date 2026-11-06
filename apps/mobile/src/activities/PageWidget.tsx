import type { PageWidgetProps } from './pageWidgetProps'

/** No home-screen widget on the web build; the sync calls this and nothing happens. */
export const PageWidget: { updateSnapshot(props: PageWidgetProps): void } | null = null
