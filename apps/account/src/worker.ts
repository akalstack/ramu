// The same app on Cloudflare Workers, with `nodejs_compat` for pg and Hyperdrive pooling the Postgres connections.
// Nothing here is Cloudflare-only beyond the entry point: KV, D1 and Durable Objects stay out of the service.
import pg from 'pg'
import { createApp } from './app'
import { createAuth } from './auth'
import { configFrom } from './config'

interface WorkerEnv {
  HYPERDRIVE?: { connectionString: string }
  [name: string]: unknown
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const values = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string')) as Record<
      string,
      string
    >
    const config = configFrom({ ...values, DATABASE_URL: env.HYPERDRIVE?.connectionString ?? values.DATABASE_URL })
    // A Worker's I/O belongs to one request, so each request gets its own small pool.
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
    try {
      return await createApp(pool, createAuth(pool, config)).fetch(request)
    } finally {
      await pool.end()
    }
  },
}
