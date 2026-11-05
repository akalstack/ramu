/**
 * The environment for commands the person or an agent runs: providers, terminals, checks and setup. The desktop's
 * background service runs with `ELECTRON_RUN_AS_NODE` so its Electron binary acts as Node; passed on, it would make
 * an Electron app they start (`electron .`, an editor, Ramu itself in development) run as plain Node and fail.
 */
export function userEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}
