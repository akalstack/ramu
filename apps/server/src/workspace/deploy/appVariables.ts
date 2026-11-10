// The variables an app reads, from the files Git would track (ignored folders such as node_modules are skipped).
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appVariables as scan, ENV_CODE_EXTENSIONS, ENV_EXAMPLE_FILES } from '@ramu/shared/appVariables'
import { git } from '../git'

const FILE_LIMIT = 4000
const FILE_BYTES = 512 * 1024
const TOTAL_BYTES = 32 * 1024 * 1024

/** The repository's code and example env files, bounded in count and size; links are skipped. */
async function readCodeFiles(root: string): Promise<{ path: string; text: string }[]> {
  const paths = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0')
    .filter((path) => path && (ENV_CODE_EXTENSIONS.test(path) || ENV_EXAMPLE_FILES.includes(path.split('/').pop()!)))
    .slice(0, FILE_LIMIT)
  const files: { path: string; text: string }[] = []
  let total = 0
  for (const path of paths) {
    // Links are skipped, so nothing outside the repository is read.
    const info = await lstat(join(root, path)).catch(() => null)
    if (!info?.isFile() || info.size > FILE_BYTES || total + info.size > TOTAL_BYTES) continue
    total += info.size
    files.push({ path, text: await readFile(join(root, path), 'utf8').catch(() => '') })
  }
  return files
}

export async function appVariables(root: string): Promise<string[]> {
  return scan(await readCodeFiles(root))
}
