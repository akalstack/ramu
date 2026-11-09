/**
 * The environment for commands the person or an agent runs: providers, terminals, checks and setup. The desktop's
 * background service runs with `ELECTRON_RUN_AS_NODE` so its Electron binary acts as Node; passed on, it would make
 * an Electron app they start (`electron .`, an editor, Ramu itself in development) run as plain Node and fail.
 */
export function userEnvironment(extra: NodeJS.ProcessEnv = {}, cwd?: string): NodeJS.ProcessEnv {
  const env = { ...process.env, ...(cwd ? folderEnvironment(cwd) : {}), ...extra }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

let folderEnvironment: (cwd: string) => Record<string, string> = () => ({})

/**
 * What a process started in a project folder adds: its identity's Git author, so agents, terminals and Ramu's own Git
 * calls commit as that identity without changing the person's Git config.
 */
export function setFolderEnvironment(resolve: (cwd: string) => Record<string, string>) {
  folderEnvironment = resolve
}

export const environmentFor = (cwd: string) => folderEnvironment(cwd)
