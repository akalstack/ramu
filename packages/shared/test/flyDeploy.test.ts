import { describe, expect, it } from 'vitest'
import { flyAppName, flyToml, flyTomlApp, flyWorkflow, FLY_SECRET } from '../src/flyDeploy'

describe('Fly.io deploy files', () => {
  it('names the app in Fly’s alphabet and reads the app an existing fly.toml names', () => {
    expect(flyAppName('My Shop!')).toBe('my-shop')
    expect(flyAppName('***')).toBe('ramu-app')
    expect(flyTomlApp(flyToml('my-shop', 3000))).toBe('my-shop')
    expect(flyTomlApp("app = 'other-app'\nprimary_region = 'ams'\n")).toBe('other-app')
    expect(flyTomlApp('primary_region = "ams"\n')).toBeNull()
  })

  it('serves the container’s port over HTTPS and stops idle machines', () => {
    const toml = flyToml('my-shop', 8000)
    expect(toml).toContain('internal_port = 8000')
    expect(toml).toContain('force_https = true')
    expect(toml).toContain('min_machines_running = 0')
  })

  it('builds with flyctl after CI, and deploys an earlier commit’s image again on dispatch', () => {
    const workflow = flyWorkflow({ app: 'my-shop', defaultBranch: 'main', afterCi: true })
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('run-name: Deploy ${{ inputs.tag')
    expect(workflow).toContain('flyctl deploy --remote-only --image-label "$TAG"')
    expect(workflow).toContain('flyctl deploy --image "registry.fly.io/$APP:$TAG"')
    expect(workflow).toContain('uses: superfly/flyctl-actions/setup-flyctl@v1')
    expect(flyWorkflow({ app: 'my-shop', defaultBranch: 'main', afterCi: false })).toContain(
      '  push:\n    branches: [main]',
    )
  })

  it('reads the deploy token from a repository secret, with read-only access to the code', () => {
    const workflow = flyWorkflow({ app: 'my-shop', defaultBranch: 'main', afterCi: false })
    expect(workflow).toContain(`FLY_API_TOKEN: \${{ secrets.${FLY_SECRET} }}`)
    expect(workflow).toContain('permissions:\n  contents: read\n')
    expect(workflow).not.toContain('packages: write')
    expect(workflow).not.toMatch(/FlyV1|fm2_/)
  })
})
