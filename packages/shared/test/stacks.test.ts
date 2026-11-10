import { expect, it } from 'vitest'
import {
  DEPLOY_TARGET_PLUGINS,
  PLUGIN_DEPLOY_TARGETS,
  STACKS,
  chooseStack,
  commandLine,
  isPluginDeployTarget,
  stackCheck,
} from '../src/stacks'

it('chooses the smallest stack that does the job', () => {
  expect(chooseStack({ kind: 'web', signIn: false, data: false })).toBe('static')
  expect(chooseStack({ kind: 'web', signIn: false, data: false, content: true })).toBe('astro')
  expect(chooseStack({ kind: 'web', signIn: false, data: true })).toBe('nextjs')
  expect(chooseStack({ kind: 'phone', signIn: true, data: true })).toBe('expo')
  expect(chooseStack({ kind: 'api', signIn: false, data: true })).toBe('node-api')
  expect(chooseStack({ kind: 'api', signIn: false, data: false, language: 'python' })).toBe('fastapi')
  expect(chooseStack({ kind: 'web', signIn: true, data: true, language: 'ruby' })).toBe('rails')
})

it('gives every stack a deploy target and argument-list commands, and checks with build then tests', () => {
  for (const stack of Object.values(STACKS)) {
    expect(stack.deployTarget).toBeTruthy()
    for (const step of [...stack.generator, stack.dev, stack.build, stack.test].filter(Boolean))
      expect(Array.isArray(step) && step.every((arg) => typeof arg === 'string')).toBe(true)
  }
  expect(stackCheck(STACKS.nextjs)).toBe('npm run build && npm run lint')
  expect(stackCheck(STACKS.static)).toBeNull()
  expect(commandLine(['uv', 'add', 'fastapi[standard]', "it's here"])).toBe(`uv add fastapi[standard] 'it'\\''s here'`)
})

it('names the deploy targets a plugin provides, and no others', () => {
  const targets = new Set(Object.values(STACKS).map((stack) => stack.deployTarget))
  expect([...targets].filter(isPluginDeployTarget).sort()).toEqual(['fly', 'railway'])
  expect(PLUGIN_DEPLOY_TARGETS.cloudflare).toBe('Cloudflare')
  // Ramu's CLI plugin is named apart from the platform's own plugin in Claude's directory, so both install.
  expect(DEPLOY_TARGET_PLUGINS.railway).toBe('railway-cli')
  expect(isPluginDeployTarget('vercel')).toBe(false)
  expect(isPluginDeployTarget('toString')).toBe(false)
  expect(isPluginDeployTarget(null)).toBe(false)
})
