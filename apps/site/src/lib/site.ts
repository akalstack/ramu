export const REPO = 'https://github.com/akalstack/ramu'
export const AKALSTACK = 'https://akalstack.com'
export const RELEASES = `${REPO}/releases`
export const MOBILE_SETUP = `${REPO}/blob/main/apps/mobile/README.md`

export type Provider = { id: string; name: string; logo: string; signIn: string }

export const PROVIDERS: Provider[] = [
  { id: 'claude', name: 'Claude Code', logo: '/providers/claude.svg', signIn: 'Install Claude Code and sign in' },
  { id: 'codex', name: 'Codex', logo: '/providers/openai.svg', signIn: 'Install Codex and sign in' },
  { id: 'opencode', name: 'OpenCode', logo: '/providers/opencode.svg', signIn: 'Connect your model provider' },
  { id: 'cursor', name: 'Cursor', logo: '/providers/cursor.svg', signIn: 'Sign in with your Cursor account' },
  {
    id: 'antigravity',
    name: 'Antigravity',
    logo: '/providers/antigravity.svg',
    signIn: 'Sign in with Google in Settings',
  },
]

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id)!
