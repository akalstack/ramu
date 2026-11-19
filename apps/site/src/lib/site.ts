// The desktop's own marks, bundled at build time so the site never keeps copies that drift. The site is dark, so it
// takes each mark's version for dark surfaces.
import azureDevopsLogo from '../../../web/src/assets/brands/azure-devops.svg?url'
import bitbucketLogo from '../../../web/src/assets/brands/bitbucket.svg?url'
import cloudflareLogo from '../../../web/src/assets/brands/cloudflare.svg?url'
import flyLogo from '../../../web/src/assets/brands/fly.svg?url'
import githubLogo from '../../../web/src/assets/brands/github-dark.svg?url'
import gitlabLogo from '../../../web/src/assets/brands/gitlab.svg?url'
import netlifyLogo from '../../../web/src/assets/brands/netlify.svg?url'
import railwayLogo from '../../../web/src/assets/brands/railway-dark.svg?url'
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

/* The phone app's store pages. Each badge is the store's own artwork, unchanged. Google Play's address comes from the package name; the App Store's needs the numeric
   Apple ID that App Store Connect gives the app, and until it is set the badge opens the phone setup guide. */
const PACKAGE = 'com.akalstack.ramu'
const APPLE_ID = ''
export const STORES = [
  {
    label: 'Download on the App Store',
    badge: '/badges/app-store.svg',
    width: 120,
    href: APPLE_ID ? `https://apps.apple.com/app/id${APPLE_ID}` : MOBILE_SETUP,
  },
  {
    label: 'Get it on Google Play',
    badge: '/badges/google-play.png',
    width: 134,
    href: `https://play.google.com/store/apps/details?id=${PACKAGE}`,
  },
]

export type Provider = { id: string; name: string; logo: string; signIn: string }

export const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude Code', logo: claudeLogo, signIn: 'Install Claude Code and sign in' },
  { id: 'codex', name: 'Codex', logo: openaiLogo, signIn: 'Install Codex and sign in' },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo, signIn: 'Connect your model provider' },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo, signIn: 'Log in, or use a Cursor API key' },
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: antigravityLogo,
    signIn: 'Ramu installs it, then sign in with Google',
  },
]

/** Hosting reached through each platform's own plugin, and the Git hosts Ramu works with itself. */
export const SERVICES = [
  { name: 'Vercel', logo: vercelLogo, role: 'Deploy plugin' },
  { name: 'Netlify', logo: netlifyLogo, role: 'Deploy plugin' },
  { name: 'Railway', logo: railwayLogo, role: 'Deploy plugin' },
  { name: 'Cloudflare', logo: cloudflareLogo, role: 'Deploy plugin' },
  { name: 'Fly.io', logo: flyLogo, role: 'Deploy CLI' },
  { name: 'GitHub', logo: githubLogo, role: 'Pull requests' },
  { name: 'GitLab', logo: gitlabLogo, role: 'Merge requests' },
  { name: 'Bitbucket', logo: bitbucketLogo, role: 'Pull requests' },
  { name: 'Azure DevOps', logo: azureDevopsLogo, role: 'Pull requests' },
]
