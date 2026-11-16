import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Files on the system clipboard travel as `text/uri-list`: Chromium maps it to Finder's file URLs, Explorer's file
 * drops and Linux file managers alike, so one format covers copying in either direction.
 */
export const FILE_LIST_TYPE = 'text/uri-list'
const MAX_FILES = 100

/** Absolute paths from a uri-list; anything that is not a local file URL is ignored. */
export function pathsFromUriList(text: string): string[] {
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .flatMap((line) => {
      try {
        return [fileURLToPath(line)]
      } catch {
        return []
      }
    })
  return [...new Set(paths.filter((path) => isAbsolute(path)))].slice(0, MAX_FILES)
}

/** The clipboard entry that lets a file manager paste these files, with the paths as text for everything else. */
export function fileListEntry(paths: string[]): Record<string, string> {
  return {
    [FILE_LIST_TYPE]: paths.map((path) => pathToFileURL(path).href).join('\r\n'),
    'text/plain': paths.join('\n'),
  }
}
