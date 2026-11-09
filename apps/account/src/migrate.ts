// Applies the SQL files in migrations/ in order, each once, recorded in ramu_migrations. One tool owns the schema, and
// moving providers is pg_dump, pg_restore and a new DATABASE_URL.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

export async function migrate(
  pool: pg.Pool,
  folder = join(import.meta.dirname, '..', 'migrations'),
): Promise<string[]> {
  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query(
      'create table if not exists ramu_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    const done = new Set(
      (await client.query<{ name: string }>('select name from ramu_migrations')).rows.map((row) => row.name),
    )
    for (const name of readdirSync(folder)
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      if (done.has(name)) continue
      await client.query('begin')
      try {
        await client.query(readFileSync(join(folder, name), 'utf8'))
        await client.query('insert into ramu_migrations (name) values ($1)', [name])
        await client.query('commit')
        applied.push(name)
      } catch (error) {
        await client.query('rollback')
        throw new Error(`${name}: ${(error as Error).message}`, { cause: error })
      }
    }
  } finally {
    client.release()
  }
  return applied
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Set DATABASE_URL to the Postgres database to migrate.')
  const pool = new pg.Pool({ connectionString: url })
  const applied = await migrate(pool)
  console.log(applied.length ? `Applied ${applied.join(', ')}.` : 'Already up to date.')
  await pool.end()
}
