// The desktop's own marks, bundled at build time so the site never keeps copies that drift. The site is dark, so it
// takes each mark's version for dark surfaces.
import azureDevopsLogo from '../../../web/src/assets/brands/azure-devops.svg?url'
import bitbucketLogo from '../../../web/src/assets/brands/bitbucket.svg?url'
import cloudflareLogo from '../../../web/src/assets/brands/cloudflare.svg?url'
import expoLogo from '../../../web/src/assets/brands/expo-dark.svg?url'
import flyLogo from '../../../web/src/assets/brands/fly.svg?url'
import githubLogo from '../../../web/src/assets/brands/github-dark.svg?url'
import gitlabLogo from '../../../web/src/assets/brands/gitlab.svg?url'
import netlifyLogo from '../../../web/src/assets/brands/netlify.svg?url'
import railwayLogo from '../../../web/src/assets/brands/railway-dark.svg?url'
import supabaseLogo from '../../../web/src/assets/brands/supabase.svg?url'
import vercelLogo from '../../../web/src/assets/brands/vercel-dark.svg?url'
import antigravityLogo from '../../../web/src/assets/providers/antigravity.svg?url'
import claudeLogo from '../../../web/src/assets/providers/claude.svg?url'
import cursorLogo from '../../../web/src/assets/providers/cursor-dark.svg?url'
import openaiLogo from '../../../web/src/assets/providers/openai-dark.svg?url'
import opencodeLogo from '../../../web/src/assets/providers/opencode-dark.svg?url'

export const REPO = 'https://github.com/akalstack/ramu'
export const AKALSTACK = 'https://akalstack.com'
export const RELEASES = `${REPO}/releases`
export const MOBILE_SETUP = `${REPO}/blob/main/apps/mobile/README.md`

export type Provider = { id: string; name: string; logo: string; signIn: string }

export const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude Code', logo: claudeLogo, signIn: 'Install Claude Code and sign in' },
  { id: 'codex', name: 'Codex', logo: openaiLogo, signIn: 'Install Codex and sign in' },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo, signIn: 'Connect your model provider' },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo, signIn: 'Sign in with your Cursor account' },
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: antigravityLogo,
    signIn: 'Sign in with Google in Settings',
  },
]

/** Services a project ships to or works through, each with what Ramu uses it for. */
export const SERVICES = [
  { name: 'Vercel', logo: vercelLogo, role: 'Hosting' },
  { name: 'Netlify', logo: netlifyLogo, role: 'Hosting' },
  { name: 'Railway', logo: railwayLogo, role: 'Hosting' },
  { name: 'Fly.io', logo: flyLogo, role: 'Hosting' },
  { name: 'Cloudflare', logo: cloudflareLogo, role: 'Hosting' },
  { name: 'Supabase', logo: supabaseLogo, role: 'Database' },
  { name: 'Expo', logo: expoLogo, role: 'App stores' },
  { name: 'GitHub', logo: githubLogo, role: 'Pull requests' },
  { name: 'GitLab', logo: gitlabLogo, role: 'Merge requests' },
  { name: 'Bitbucket', logo: bitbucketLogo, role: 'Pull requests' },
  { name: 'Azure DevOps', logo: azureDevopsLogo, role: 'Pull requests' },
]
