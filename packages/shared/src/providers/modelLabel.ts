// How pickers on the desktop and the phone name a model: a clean name, and the route it runs through when it has one.
import type { AgentModel } from '../types'
import { providerName } from './providers'

/** A model's name as Ramu shows it: GPT names capitalized as OpenAI writes them, and no provider said twice. */
export const modelDisplayName = (name: string) =>
  name
    // OpenCode can name a model with its provider repeated, as "9router/9Router Auto"; once is enough. A prefix that
    // says something else ("opencode/Tidepool Alpha") stays, since it tells routes apart.
    .replace(/^([^/\s]+)\/(?=\1)/i, '')
    .replace(/^gpt-/i, 'GPT-')
    .replace(
      /-(sol|luna|astra|terra)\b/gi,
      (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}`,
    )

/** The model providers OpenCode routes to, by the id it gives them, as their owners write their names. */
const ROUTES: Record<string, string> = {
  openrouter: 'OpenRouter',
  opencode: 'OpenCode Zen',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'google-vertex': 'Google Vertex',
  'github-copilot': 'GitHub Copilot',
  'amazon-bedrock': 'Amazon Bedrock',
  azure: 'Azure',
  groq: 'Groq',
  mistral: 'Mistral',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  cerebras: 'Cerebras',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  vercel: 'Vercel',
  togetherai: 'Together AI',
  fireworks: 'Fireworks',
  moonshotai: 'Moonshot AI',
  zai: 'Z.ai',
}

const routeName = (id: string) =>
  ROUTES[id.toLowerCase()] ??
  id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')

/**
 * A name written as an id ("Nex-N2.5-Pro", "nemotron-3-ultra") read as words. GPT keeps the hyphen OpenAI writes, and
 * a hyphen between two numbers stays, since it can be part of a version.
 */
const fromSlug = (name: string) => {
  if (/\s/.test(name) || !name.includes('-')) return name
  return name
    .split('-')
    .reduce((text, part) => {
      if (!text) return part
      const joined = /(^|\s)GPT$/.test(text) || (/\d$/.test(text) && /^\d/.test(part))
      return `${text}${joined ? '-' : ' '}${part}`
    }, '')
    .replace(/(^|\s)([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase())
}

export interface ModelLabel {
  /** The model's own name, without the route in front of it. */
  name: string
  /** Who serves it when its provider routes to others, as OpenCode does ("OpenRouter"); null when it does not. */
  route: string | null
}

/**
 * A model as a picker lists it. OpenCode names a model by its route and the route's model ("openrouter/Nex-N2.5-Pro"),
 * which reads as an id: the route moves out of the name, so rows show "Nex N2.5 Pro" under "OpenRouter".
 */
export function modelLabel(model: Pick<AgentModel, 'provider' | 'id' | 'name'>): ModelLabel {
  const slash = model.id.indexOf('/')
  if (model.provider !== 'opencode' || slash <= 0) return { name: modelDisplayName(model.name), route: null }
  const route = model.id.slice(0, slash)
  const prefix = `${route.toLowerCase()}/`
  const own = model.name.toLowerCase().startsWith(prefix) ? model.name.slice(prefix.length) : model.name
  return { name: fromSlug(modelDisplayName(own.trim() || model.name)), route: routeName(route) }
}

/** Everything a person might type to find a model: its names, its route, its provider and its id. */
export function modelSearchText(model: Pick<AgentModel, 'provider' | 'id' | 'name'>): string {
  const label = modelLabel(model)
  return [label.name, label.route ?? '', providerName(model.provider), model.name, model.id].join(' ')
}
