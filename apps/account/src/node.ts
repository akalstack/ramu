// The service under Node, on any server: `DATABASE_URL=… BETTER_AUTH_SECRET=… pnpm --filter @ramu/account dev`.
import { serve } from '@hono/node-server'
import pg from 'pg'
import { createApp } from './app'
import { createAuth } from './auth'
import { configFrom } from './config'

const config = configFrom(process.env)
const pool = new pg.Pool({ connectionString: config.databaseUrl })
const app = createApp(pool, createAuth(pool, config))
const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, () => console.log(`Ramu account service on http://localhost:${port}`))
