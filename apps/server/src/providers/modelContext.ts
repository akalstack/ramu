/** Optional model metadata. Never infer capacity from a model name or accept invalid provider values. */
export function modelContextWindow(model: unknown): number | undefined {
  if (!model || typeof model !== 'object') return undefined
  const data = model as Record<string, unknown>
  const limit = data.limit as { context?: unknown } | undefined
  for (const value of [data.contextWindow, data.contextWindowTokens, data.context_window, limit?.context])
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return undefined
}
