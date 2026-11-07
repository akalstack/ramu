// Binding Cloudflare resources into a Worker's wrangler config, found from the Worker's own types, and the deploy job's
// migrations step.
import { describe, expect, it } from 'vitest'
import { withWorkerBinding, workerBindings, workersWorkflow } from '../src/cloudflareDeploy'

describe('binding Cloudflare resources to a Worker', () => {
  const pair = { name: 'shop', id: 'prod-id', previewId: 'preview-id' }

  it('finds the binding names the code types as D1, KV and R2', () => {
    const code = 'export interface Env {\n  DB: D1Database\n  CACHE?: KVNamespace\n  FILES: R2Bucket\n}'
    expect(workerBindings([{ text: code }])).toEqual({ D1Database: 'DB', KVNamespace: 'CACHE', R2Bucket: 'FILES' })
    expect(workerBindings([{ text: 'const x = 1' }])).toEqual({})
  })

  it('adds each kind of table to wrangler.toml with its preview copy, next to tables already there', () => {
    const toml = withWorkerBinding('wrangler.toml', 'name = "shop"\n', 'D1Database', 'DB', pair)
    expect(toml).toContain('[[d1_databases]]\nbinding = "DB"\ndatabase_name = "shop"\ndatabase_id = "prod-id"')
    expect(toml).toContain('preview_database_id = "preview-id"')
    const kv = withWorkerBinding('wrangler.toml', toml, 'KVNamespace', 'CACHE', pair)
    expect(kv).toContain('[[kv_namespaces]]\nbinding = "CACHE"\nid = "prod-id"\npreview_id = "preview-id"')
    const r2 = withWorkerBinding('wrangler.toml', kv, 'R2Bucket', 'FILES', pair)
    expect(r2).toContain(
      '[[r2_buckets]]\nbinding = "FILES"\nbucket_name = "prod-id"\npreview_bucket_name = "preview-id"',
    )
  })

  it('appends to wrangler.json, and refuses a taken name and a wrangler.jsonc', () => {
    const json = JSON.parse(
      withWorkerBinding(
        'wrangler.json',
        '{"name":"shop","kv_namespaces":[{"binding":"OTHER","id":"x"}]}',
        'KVNamespace',
        'KV',
        pair,
      ),
    ) as { kv_namespaces: unknown[] }
    expect(json.kv_namespaces).toHaveLength(2)
    expect(() => withWorkerBinding('wrangler.toml', 'binding = "DB"\n', 'D1Database', 'DB', pair)).toThrow(
      'already has',
    )
    expect(() => withWorkerBinding('wrangler.jsonc', '// note\n{}', 'D1Database', 'DB', pair)).toThrow('yourself')
  })

  it('applies the migrations before deploying when the job knows the D1 binding', () => {
    const job = workersWorkflow({ defaultBranch: 'main', afterCi: false, manager: 'npm', d1: 'DB' })
    expect(job).toContain('command: d1 migrations apply DB --remote')
    expect(job.indexOf('d1 migrations apply')).toBeLessThan(job.indexOf('command: deploy'))
    expect(workersWorkflow({ defaultBranch: 'main', afterCi: false, manager: 'npm' })).not.toContain('migrations')
  })
})
