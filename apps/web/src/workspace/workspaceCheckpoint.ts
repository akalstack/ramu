// Registration stays browser-independent so draft persistence can be tested without an IPC bridge.
import { ownHostId } from '../hosts'

type Checkpoint = () => Promise<boolean>

/** Per host: everything that must be saved before the renderer may sleep. */
const byHost = new Map<string, Set<Checkpoint>>()

/**
 * Something on `host` that must be saved before this renderer is released. Without a host it belongs to the window's
 * own host; drafts, the composer and chats pass the host of the store they render under (`useHost().id`).
 */
export function registerWorkspaceCheckpoint(checkpoint: Checkpoint, host = ownHostId()) {
  const set = byHost.get(host) ?? new Set<Checkpoint>()
  byHost.set(host, set)
  set.add(checkpoint)
  return () => {
    set.delete(checkpoint)
    if (!set.size && byHost.get(host) === set) byHost.delete(host)
  }
}

/** Hosts that registered a checkpoint, so a failed release can clear each one's resume snapshot. */
export const checkpointHosts = (): string[] => [...byHost.keys()]

/** Every host's checkpoints. The renderer is released as a whole, so all must succeed. */
export const allWorkspaceCheckpoints = (): Checkpoint[] => [...byHost.values()].flatMap((set) => [...set])
