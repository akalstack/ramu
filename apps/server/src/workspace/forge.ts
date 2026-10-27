// The forge boundary the rest of the server imports. GitHub is the only adapter today (`forge/github.ts`, with its
// direct API client in `forge/githubApi.ts`); another host adds its own adapter beside it and registers in
// `forge/adapter.ts`, and callers keep importing from here.
export * from './forge/github'
export { forgeAdapter } from './forge/adapter'
