// The renderer's only door into privileged code: one validated method table.
// Handlers live in ./ipc/handlers, one module per domain; this file is the public entry point.
export { createDispatcher } from './ipc/dispatcher'
export { migrateChains } from './ipc/preferences'
export type { Services } from './ipc/types'
