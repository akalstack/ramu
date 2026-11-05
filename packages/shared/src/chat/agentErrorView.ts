export interface AgentErrorView {
  /** Says what went wrong in Ramu's words; the provider's own message stays underneath. */
  title: string
  /** The next step that fixes it, when there is one. */
  action?: 'model' | 'providers' | 'retry'
}

const KINDS: [RegExp, AgentErrorView][] = [
  // Cursor refuses SDK agents for free accounts, even ones running on this computer ("Cloud Agent" is its wording).
  [
    /\bplan_required\b|\bnot available for free (users|plans?)\b|\bupgrade to (pro|a paid plan)\b/i,
    { title: 'This account needs a paid plan', action: 'providers' },
  ],
  [
    /\bmodel\b.*\b(not supported|unsupported|not available|unavailable|does not exist|not found|invalid)\b|\b(unknown|invalid|unsupported) model\b|\bcannot use this model\b/i,
    { title: 'This model isn’t available', action: 'model' },
  ],
  [
    /\b(not logged in|not signed in|login required|sign in|unauthori[sz]ed|authentication|invalid api key|401)\b/i,
    { title: 'Sign-in needed', action: 'providers' },
  ],
  [
    /\b(rate limit|rate-limit|too many requests|429|overloaded|quota|usage limit)\b/i,
    { title: 'The provider is limiting requests', action: 'retry' },
  ],
  [
    /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch failed|socket hang up|timed out)\b/i,
    { title: 'Connection problem', action: 'retry' },
  ],
]

/** Reads a provider's error text, which has no codes across providers, into a title and a way forward. */
export function agentErrorView(message: string): AgentErrorView {
  return (
    KINDS.find(([pattern]) => pattern.test(message))?.[1] ?? {
      title: 'The agent stopped with an error',
      action: 'retry',
    }
  )
}
