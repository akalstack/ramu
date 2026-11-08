// The desktop's own marks, bundled at build time so the site never keeps copies that drift.
import antigravityLogo from '../../../web/src/assets/providers/antigravity.svg?url'
import claudeLogo from '../../../web/src/assets/providers/claude.svg?url'
import cursorLogo from '../../../web/src/assets/providers/cursor.svg?url'
import openaiLogo from '../../../web/src/assets/providers/openai.svg?url'
import opencodeLogo from '../../../web/src/assets/providers/opencode.svg?url'

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
