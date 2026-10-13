export type ChangeFolder<T extends { path: string }> = { name: string; path: string; folders: ChangeFolder<T>[]; files: T[]; paths: string[] }

/** Groups changed files by folder. A folder holding only one folder becomes one row, like src/renderer/src. */
export function changeTree<T extends { path: string }>(entries: readonly T[]): ChangeFolder<T> {
  const root: ChangeFolder<T> = { name: '', path: '', folders: [], files: [], paths: [] }
  const index = new Map<string, ChangeFolder<T>>()
  for (const entry of entries) {
    let node = root
    root.paths.push(entry.path)
    for (const part of entry.path.split('/').slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part
      let next = index.get(path)
      if (!next) { next = { name: part, path, folders: [], files: [], paths: [] }; index.set(path, next); node.folders.push(next) }
      next.paths.push(entry.path)
      node = next
    }
    node.files.push(entry)
  }
  const sorted = (folder: ChangeFolder<T>): ChangeFolder<T> => ({
    ...folder,
    folders: folder.folders.map(compress).sort((a, b) => a.name.localeCompare(b.name)),
    files: [...folder.files].sort((a, b) => a.path.localeCompare(b.path)),
  })
  const compress = (folder: ChangeFolder<T>): ChangeFolder<T> => {
    let node = folder
    while (!node.files.length && node.folders.length === 1) { const only = node.folders[0]!; node = { ...only, name: `${node.name}/${only.name}` } }
    return sorted(node)
  }
  return sorted(root)
}
