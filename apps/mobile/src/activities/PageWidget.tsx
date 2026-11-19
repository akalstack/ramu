import type { PageWidgetProps } from './pageWidgetProps'

/** No home-screen widget on the web build; the sync never loads this there. */
export const PageWidget: { updateSnapshot(props: PageWidgetProps): void } | null = null
