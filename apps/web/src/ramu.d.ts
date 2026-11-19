import type { RamuBridge } from '@ramu/shared/api'

declare global {
  interface Window {
    ramu: RamuBridge
  }
}
