import { expect, it } from 'vitest'
import { CLAUDE_PLUGIN_INDEX, DEFAULT_PLUGIN_INDEX, DEPLOY_TARGET_PLUGINS } from '../src/plugins'
import { DEPLOY_TARGETS, STACKS, chooseStack, commandLine, isDeployTarget, stackCheck } from '../src/stacks'

it('chooses the smallest stack that does the job', () => {
  expect(chooseStack({ kind: 'web', signIn: false, data: false })).toBe('static')
  expect(chooseStack({ kind: 'web', signIn: false, data: false, content: true })).toBe('astro')
  expect(chooseStack({ kind: 'web', signIn: false, data: true })).toBe('nextjs')
  expect(chooseStack({ kind: 'phone', signIn: true, data: true })).toBe('expo')
  expect(chooseStack({ kind: 'api', signIn: false, data: true })).toBe('node-api')
  expect(chooseStack({ kind: 'api', signIn: false, data: false, language: 'python' })).toBe('fastapi')
  expect(chooseStack({ kind: 'web', signIn: true, data: true, language: 'ruby' })).toBe('rails')
})

it('gives every web stack a deploy target and argument-list commands, and checks with build then tests', () => {
  for (const stack of Object.values(STACKS)) {
    expect(stack.deployTarget === null).toBe(stack.id === 'expo')
    for (const step of [...stack.generator, stack.dev, stack.build, stack.test].filter(Boolean))
      expect(Array.isArray(step) && step.every((arg) => typeof arg === 'string')).toBe(true)
  }
  expect(stackCheck(STACKS.nextjs)).toBe('npm run build && npm run lint')
  expect(stackCheck(STACKS.static)).toBeNull()
  expect(commandLine(['uv', 'add', 'fastapi[standard]', "it's here"])).toBe(`uv add fastapi[standard] 'it'\\''s here'`)
})

it('deploys every target through the platform’s own plugin, or Ramu’s where Claude’s directory has none', () => {
  for (const stack of Object.values(STACKS))
    if (stack.deployTarget) expect(DEPLOY_TARGET_PLUGINS[stack.deployTarget].name).toBeTruthy()
  expect(DEPLOY_TARGETS.cloudflare).toBe('Cloudflare')
  expect(DEPLOY_TARGET_PLUGINS.vercel).toEqual({ index: CLAUDE_PLUGIN_INDEX, name: 'vercel' })
  expect(DEPLOY_TARGET_PLUGINS.fly).toEqual({ index: DEFAULT_PLUGIN_INDEX, name: 'fly-cli' })
  expect(isDeployTarget('netlify')).toBe(true)
  expect(isDeployTarget('expo')).toBe(false)
  expect(isDeployTarget('toString')).toBe(false)
  expect(isDeployTarget(null)).toBe(false)
})
