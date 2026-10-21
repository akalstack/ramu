/** Bounds how many generated documents execute at once in each application renderer; the oldest claim stops first. */
let owners: (() => void)[] = []
export function claimInteractive(stop: () => void, limit = 1): () => void {
  owners = owners.filter((owner) => owner !== stop)
  owners.push(stop)
  while (owners.length > Math.max(1, limit)) owners.shift()!()
  return () => {
    owners = owners.filter((owner) => owner !== stop)
  }
}
