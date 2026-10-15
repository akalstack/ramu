// Registration stays browser-independent so draft persistence can be tested without an IPC bridge.
export const workspaceCheckpoints = new Set<() => Promise<boolean>>()
export function registerWorkspaceCheckpoint(checkpoint: () => Promise<boolean>) { workspaceCheckpoints.add(checkpoint); return () => { workspaceCheckpoints.delete(checkpoint) } }
