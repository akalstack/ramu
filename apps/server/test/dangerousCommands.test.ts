import { expect, it } from 'vitest'
import { productionDeploy } from '../src/agent/dangerousCommands'

it('names a production deploy, the one command Ramu asks about at every access level', () => {
  expect(productionDeploy('npx vercel deploy --prod')).toBe('Deploys to production')
  expect(productionDeploy('vercel deploy')).toBeNull()
  expect(productionDeploy('rm -rf ~')).toBeNull()
  // Inside a shell's script, as Codex sends every command.
  expect(productionDeploy('bash -lc npx vercel deploy --prod')).toBe('Deploys to production')
  expect(productionDeploy(`/bin/zsh -c 'vercel deploy --prod'`)).toBe('Deploys to production')
})
