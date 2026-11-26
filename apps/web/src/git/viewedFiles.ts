import type { PullRequestFile } from '@ramu/shared/types'

/**
 * A short fingerprint of a file's diff: enough to notice that it changed. A Viewed tick is kept with it, so a file that
 * changed since it was ticked is unticked again and a tick always means "I read what is here now".
 */
export function diffSignature(file: Pick<PullRequestFile, 'patch' | 'additions' | 'deletions' | 'status'>): string {
  const text = file.patch ?? ''
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return `${file.status}:${file.additions}:${file.deletions}:${text.length}:${hash >>> 0}`
}

/** What a tick on this file is kept under: the file as it reads now. */
export const viewedKey = (file: PullRequestFile) => `${file.path}\n${diffSignature(file)}`
