// Binding a D1 database into a Worker's wrangler config, and the deploy job's migrations step.
import { describe, expect, it } from 'vitest'
import { withD1Binding, workersWorkflow } from '../src/cloudflareDeploy'

describe('binding D1 to a Worker', () => {
  const d1 = { name: 'shop', id: 'prod-uuid', previewId: 'preview-uuid' }

  it('adds a d1_databases table to wrangler.toml and an entry to wrangler.json, with the preview database', () => {
    const toml = withD1Binding('wrangler.toml', 'name = "shop"\nmain = "src/index.ts"\n', d1)
    expect(toml).toContain('[[d1_databases]]\nbinding = "DB"\ndatabase_name = "shop"\ndatabase_id = "prod-uuid"')
    expect(toml).toContain('preview_database_id = "preview-uuid"')
    expect(toml.startsWith('name = "shop"\nmain = "src/index.ts"\n\n')).toBe(true)
    const json = JSON.parse(withD1Binding('wrangler.json', '{"name":"shop"}', d1)) as Record<string, unknown>
    expect(json).toMatchObject({ name: 'shop', d1_databases: [{ binding: 'DB', database_id: 'prod-uuid' }] })
  })

  it('refuses a config that already binds D1, and a wrangler.jsonc whose comments it would lose', () => {
    expect(() => withD1Binding('wrangler.toml', '[[d1_databases]]\n', d1)).toThrow('already binds')
    expect(() => withD1Binding('wrangler.jsonc', '// note\n{"name":"shop"}', d1)).toThrow('yourself')
  })

  it('applies the migrations before deploying when the job knows the binding', () => {
    const job = workersWorkflow({ defaultBranch: 'main', afterCi: false, manager: 'npm', d1: 'DB' })
    expect(job).toContain('command: d1 migrations apply DB --remote')
    expect(job.indexOf('d1 migrations apply')).toBeLessThan(job.indexOf('command: deploy'))
    expect(workersWorkflow({ defaultBranch: 'main', afterCi: false, manager: 'npm' })).not.toContain('migrations')
  })
})
