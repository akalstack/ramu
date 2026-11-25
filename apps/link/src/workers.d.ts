// The few Workers runtime shapes this relay uses, declared here instead of pulling in the whole runtime type package.

interface SqlCursor<T> {
  toArray(): T[]
}
interface SqlStorage {
  exec<T = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): SqlCursor<T>
}
type SqlValue = string | number | null

interface DurableObjectState {
  storage: { sql: SqlStorage; transactionSync<T>(run: () => T): T }
  blockConcurrencyWhile<T>(run: () => Promise<T>): Promise<T>
  /** Hibernation: the object may sleep while its sockets stay open. */
  acceptWebSocket(socket: WebSocket): void
  getWebSockets(): WebSocket[]
  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void
}
interface WebSocket {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string)
}
declare class WebSocketPair {
  0: WebSocket
  1: WebSocket
}
interface ResponseInit {
  webSocket?: WebSocket
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): DurableObjectStub
}
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}
interface ScheduledController {
  scheduledTime: number
  cron: string
}
interface CacheStorage {
  readonly default: Cache
}
