import type { RamuBridge } from '../shared/api'

declare global {
  interface Window {
    ramu: RamuBridge
  }
}
