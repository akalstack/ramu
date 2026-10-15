export function useWorkspace() {
  return (window as any).debugWorkspace
}
export function isWorktreeCtx() {
  return false
}
