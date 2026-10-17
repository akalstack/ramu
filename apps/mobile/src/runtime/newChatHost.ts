/** Resolve a draft's explicit host; never substitute the global selection. */
export function newChatHost(
  computerId: string,
  projectId: string,
  computers: { id: string; status: string }[],
  projects: { id: string; computerId: string }[],
  standalone: string,
) {
  const host = computers.find((c) => c.id === computerId)
  if (!host || host.status === 'revoked') throw new Error('Pair a host first.')
  if (projectId !== standalone && !projects.some((p) => p.id === projectId && p.computerId === computerId))
    throw new Error('Choose a project on this host.')
  return computerId
}
