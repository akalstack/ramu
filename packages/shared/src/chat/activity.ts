/** Work owned by the service, visible across every connected window. */
export interface BackgroundActivity {
  id: string
  label: string
  detail?: string
  cancellable?: boolean
}
