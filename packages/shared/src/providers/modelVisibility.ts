/** Models the person chose to list, per provider. A provider with no entry lists everything it reports. */
export type VisibleModels = Partial<Record<string, string[]>>

/**
 * Whether a model belongs in pickers and dropdowns. An allow list rather than a hide list, so a provider with hundreds
 * of models stays short when it adds more. Callers keep showing the model currently in use, whatever this says.
 */
export function isModelListed(visible: VisibleModels | undefined, model: { provider: string; id: string }): boolean {
  const listed = visible?.[model.provider]
  return !listed || listed.includes(model.id)
}
