import { expect, it } from 'vitest'
import { firstDeployStep } from '../src/deployText'
import type { Deployment, ProjectDeployment } from '../src/types/deploy'

const binding = {
  platform: 'vercel',
  siteId: 's',
  siteName: 'shop',
  repository: 'a/b',
  productionBranch: 'main',
  accountId: 'u',
  scope: null,
}
const status = (deployments: Partial<Deployment>[]): ProjectDeployment =>
  ({
    recommended: null,
    binding,
    capabilities: [],
    productionUrl: null,
    heldForMigrations: false,
    error: null,
    deployments: deployments.map((entry, index) => ({
      id: String(index),
      url: null,
      ref: 'main',
      commit: null,
      message: null,
      createdAt: index,
      production: true,
      state: 'ready',
      ...entry,
    })),
  }) as ProjectDeployment

it('says what comes next until the first production deployment is live', () => {
  expect(firstDeployStep(status([]))).toBe('push')
  expect(firstDeployStep(status([{ production: false }]))).toBe('push')
  expect(firstDeployStep(status([{ state: 'building' }]))).toBe('building')
  expect(firstDeployStep(status([{ state: 'failed' }]))).toBe('failed')
  expect(firstDeployStep(status([{ state: 'failed' }, { state: 'ready' }]))).toBeNull()
  expect(firstDeployStep({ ...status([]), binding: null })).toBeNull()
})
