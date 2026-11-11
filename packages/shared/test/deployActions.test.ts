import { expect, it } from 'vitest'
import { argvDeploy, commandDeploy, toolDeploy } from '../src/deployActions'

it('tells a preview from a production deploy for each platform CLI', () => {
  const cases: [string, 'preview' | 'production' | null][] = [
    ['vercel', 'preview'],
    ['vercel deploy', 'preview'],
    ['vercel deploy --prebuilt', 'preview'],
    ['vercel deploy --prod', 'production'],
    ['vercel deploy --prod=true', 'production'],
    ['vercel --prod', 'production'],
    ['vercel ./site --prod', 'production'],
    ['vercel --scope team deploy --prod', 'production'],
    ['vercel deploy --target=production', 'production'],
    ['vercel promote https://app-abc.vercel.app', 'production'],
    ['vercel rollback', 'production'],
    ['vercel redeploy https://app-abc.vercel.app', 'production'],
    ['vercel redeploy https://app-abc.vercel.app --target preview', 'preview'],
    ['vercel env ls', null],
    ['vercel build --prod', null],
    ['vercel --version', null],
    ['netlify deploy', 'preview'],
    ['netlify deploy --prod', 'production'],
    ['netlify deploy --prodIfUnlocked', 'production'],
    ['netlify api restoreSiteDeploy --data {}', 'production'],
    ['netlify status', null],
    ['wrangler deploy', 'production'],
    ['wrangler pages deploy dist --project-name site', 'production'],
    ['wrangler pages deploy dist --branch feature', 'preview'],
    ['wrangler versions upload', 'preview'],
    ['wrangler versions deploy', 'production'],
    ['wrangler rollback', 'production'],
    ['wrangler dev', null],
    ['railway up --detach', 'production'],
    ['railway redeploy', 'production'],
    ['railway down', 'production'],
    ['railway logs', null],
    ['fly deploy --detach', 'production'],
    ['flyctl deploy', 'production'],
    ['fly releases rollback', 'production'],
    ['fly status', null],
    ['supabase functions deploy hello', 'production'],
    ['supabase db push', 'production'],
    ['supabase db diff', null],
    ['firebase deploy --only hosting', 'production'],
    ['firebase hosting:channel:deploy pr-12', 'preview'],
    ['gcloud run deploy api --source .', 'production'],
    ['gcloud beta app deploy', 'production'],
    ['gcloud run services list', null],
  ]
  for (const [line, kind] of cases) expect([line, commandDeploy(line)]).toEqual([line, kind])
})

it('looks through package runners, wrappers, shells and chains', () => {
  expect(commandDeploy('npx vercel deploy --prod')).toBe('production')
  expect(commandDeploy('npx --yes vercel@latest --prod')).toBe('production')
  expect(commandDeploy('pnpm dlx wrangler@4 deploy')).toBe('production')
  expect(commandDeploy('pnpm --filter web exec vercel deploy')).toBe('preview')
  expect(commandDeploy('bunx netlify-cli deploy --prod')).toBe('production')
  expect(commandDeploy('npx @railway/cli@latest up')).toBe('production')
  expect(commandDeploy('VERCEL_ORG_ID=x /usr/local/bin/vercel --prod')).toBe('production')
  expect(commandDeploy('timeout 600 fly deploy')).toBe('production')
  expect(commandDeploy("bash -lc 'cd app && vercel deploy --prod'")).toBe('production')
  expect(commandDeploy('npm run build && vercel deploy')).toBe('preview')
  expect(commandDeploy('vercel deploy && vercel promote https://x.vercel.app')).toBe('production')
  expect(commandDeploy('vercel deploy; netlify deploy --prod 2>&1 | tail -n 20')).toBe('production')
  expect(commandDeploy('vercel --prod > deploy.log')).toBe('production')
  expect(commandDeploy('echo "vercel --prod"')).toBeNull()
  expect(commandDeploy('git push origin main')).toBeNull()
  expect(argvDeploy(['fly', 'deploy', '--detach'])).toBe('production')
  expect(argvDeploy(['fly', 'logs', '--no-tail'])).toBeNull()
})

it('treats a deploy tool as production unless its arguments name a preview target', () => {
  expect(toolDeploy({ name: 'deploy_to_vercel' }, {})).toBe('production')
  expect(toolDeploy({ name: 'netlify-deploy-services' }, { siteId: 'x' })).toBe('production')
  expect(toolDeploy({ name: 'deployProject' }, { target: 'preview' })).toBe('preview')
  expect(toolDeploy({ name: 'deploy' }, { options: { environment: 'staging' } })).toBe('preview')
  expect(toolDeploy({ name: 'deploy' }, { production: false })).toBe('preview')
  expect(toolDeploy({ name: 'deploy' }, { environment: 'production' })).toBe('production')
  expect(toolDeploy({ name: 'rollback_deployment' }, {})).toBe('production')
  expect(toolDeploy({ name: 'promote_deployment' }, {})).toBe('production')
  expect(toolDeploy({ name: 'create_deployment' }, {})).toBe('production')
  expect(toolDeploy({ name: 'publishSite' }, {})).toBeNull()
  expect(toolDeploy({ name: 'create_release' }, {})).toBeNull()
  expect(toolDeploy({ name: 'list_deployments' }, {})).toBeNull()
  expect(toolDeploy({ name: 'get_deployment' }, {})).toBeNull()
  expect(toolDeploy({ name: 'get_release' }, {})).toBeNull()
  expect(toolDeploy({ name: 'search_documentation' }, {})).toBeNull()
  expect(toolDeploy({ name: 'deploy', annotations: { readOnlyHint: true } }, {})).toBeNull()
  expect(toolDeploy({ name: 'redeployer' }, {})).toBeNull()
})
