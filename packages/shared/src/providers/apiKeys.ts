import type { AgentProvider } from '../types'

/**
 * The variables a login can carry an API key in, per provider, first one preselected. OpenCode routes to many model
 * providers, so the person picks whose key it is. Antigravity chooses its key method in its own sign-in dialog, because
 * the runtime also needs to be told which method to use.
 */
export const PROVIDER_KEY_VARIABLES: Record<AgentProvider, readonly string[]> = {
  'claude-code': ['ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY'],
  cursor: ['CURSOR_API_KEY'],
  opencode: [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'MISTRAL_API_KEY',
    'XAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'CEREBRAS_API_KEY',
    'OPENCODE_API_KEY',
  ],
  antigravity: [],
}

export const supportsApiKey = (provider: AgentProvider) => PROVIDER_KEY_VARIABLES[provider].length > 0

/** Who issues the key behind a variable, so the dialog can say where to get one. */
export const API_KEY_ISSUERS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'Anthropic',
  OPENAI_API_KEY: 'OpenAI',
  CURSOR_API_KEY: 'Cursor',
  GEMINI_API_KEY: 'Google AI Studio',
  OPENROUTER_API_KEY: 'OpenRouter',
  GROQ_API_KEY: 'Groq',
  MISTRAL_API_KEY: 'Mistral',
  XAI_API_KEY: 'xAI',
  DEEPSEEK_API_KEY: 'DeepSeek',
  CEREBRAS_API_KEY: 'Cerebras',
  OPENCODE_API_KEY: 'OpenCode Zen',
}

export const MAX_API_KEY_LENGTH = 512
