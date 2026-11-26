import { unlinkSync } from 'node:fs'

/**
 * Takes the local socket path for a service about to listen on it. A path left behind by a service that exited is
 * cleared. A path a running service still answers on is refused: replacing it would cut that service off from its own
 * app and command line while it keeps running. That happens when a second server inherits another service's
 * RAMU_SOCKET with a data folder of its own, which the data folder's owner lock cannot see.
 */
export async function claimSocketPath(
  socketPath: string,
  answers: (socketPath: string) => Promise<unknown>,
  remove: (socketPath: string) => void = unlinkSync,
  /** How often to ask again before refusing, so a service finishing its shutdown is not taken for a second one. */
  patience: { tries: number; pauseMs: number } = { tries: 1, pauseMs: 0 },
): Promise<void> {
  let live = true
  for (let attempt = 0; attempt < patience.tries && live; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, patience.pauseMs))
    try {
      await answers(socketPath)
    } catch {
      live = false
    }
  }
  if (live)
    throw new Error(
      `Another Ramu service is already running on ${socketPath}. To run a second one, give it its own socket: set RAMU_SOCKET to a path of its own, or unset it so the socket follows RAMU_USER_DATA.`,
    )
  try {
    remove(socketPath)
  } catch {
    // Nothing was left there.
  }
}
