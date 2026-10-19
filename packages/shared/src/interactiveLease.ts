/** At most one generated document executes in each application renderer. */
let owner: (() => void) | undefined
export function claimInteractive(stop: () => void): () => void {
  owner?.()
  owner = stop
  return () => {
    if (owner === stop) owner = undefined
  }
}
