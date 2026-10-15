export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

/** "name copy.ext", "name copy 2.ext" … until the name is free. */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.'),
    stem = dot > 0 ? name.slice(0, dot) : name,
    ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const next = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    if (!taken.has(next)) return next
  }
}

export const isValidEntryName = (name: string) => !!name.trim() && !/[\/\\]/.test(name) && name !== '.' && name !== '..'

/** Whether `path` is `parent` itself or lives inside it. */
export const isWithin = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`)
