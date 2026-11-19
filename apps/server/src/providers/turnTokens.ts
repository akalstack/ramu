/** A running turn total with one more call added; an unreported call leaves it as it was. */
export function addTokens(
  total: { input: number; output: number } | null,
  call: { input: number; output: number } | null,
): { input: number; output: number } | null {
  if (!call) return total
  return { input: (total?.input ?? 0) + call.input, output: (total?.output ?? 0) + call.output }
}
