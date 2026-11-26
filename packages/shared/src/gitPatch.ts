import type { PullRequestFile } from './types'

/** What `git show` or `git diff` printed, taken apart: the words before the first file, and each file's own diff. */
export interface GitPatch {
  /** A commit's author, dates and message as Git printed them; empty for a comparison. */
  commit: { oid: string; author: string; date: string; subject: string; body: string } | null
  files: PullRequestFile[]
}

/** A path as Git writes it in a diff header: quoted with C escapes when it holds spaces or unusual characters. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  const bytes: number[] = []
  const inner = path.slice(1, -1)
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index]!
    if (char !== '\\') {
      bytes.push(...new TextEncoder().encode(char))
      continue
    }
    const next = inner[++index] ?? ''
    const octal = /^[0-7]{3}/.exec(inner.slice(index))?.[0]
    if (octal) {
      bytes.push(parseInt(octal, 8))
      index += 2
    } else bytes.push(...new TextEncoder().encode({ n: '\n', t: '\t', '"': '"', '\\': '\\' }[next] ?? next))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const side = (line: string | undefined, prefix: string): string | null => {
  if (!line || line === '/dev/null') return null
  const path = unquote(line)
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

function parseFile(chunk: string): PullRequestFile | null {
  const lines = chunk.split('\n')
  const at = lines.findIndex((line) => line.startsWith('@@'))
  const head = at < 0 ? lines : lines.slice(0, at)
  const find = (start: string) => head.find((line) => line.startsWith(start))?.slice(start.length)
  const from = side(find('--- '), 'a/')
  const to = side(find('+++ '), 'b/')
  // Without hunks (a rename, a mode change, a binary file) only the first line names the file.
  const named = /^diff --git (?:"a\/(.+?)"|a\/(.+?)) (?:"b\/(.+)"|b\/(.+))$/.exec(lines[0] ?? '')
  const renamedFrom = find('rename from ')
  const renamedTo = find('rename to ')
  const path = renamedTo ?? to ?? from ?? named?.[3] ?? named?.[4]
  if (!path) return null
  const added = head.some((line) => line.startsWith('new file mode'))
  const removed = head.some((line) => line.startsWith('deleted file mode'))
  const body = at < 0 ? [] : lines.slice(at)
  // A chunk ends where the next file begins; the newline before it leaves one empty line that is not part of the diff.
  if (body.at(-1) === '') body.pop()
  let additions = 0
  let deletions = 0
  for (const line of body) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return {
    path: unquote(path),
    ...(renamedFrom ? { previousPath: unquote(renamedFrom) } : {}),
    status: added ? 'added' : removed ? 'removed' : renamedFrom ? 'renamed' : 'modified',
    additions,
    deletions,
    patch: body.length ? body.join('\n') : null,
  }
}

/**
 * Reads the text of `git show --format=fuller --stat --patch` or `git diff --stat --patch` into files with their
 * hunks, so a commit or a comparison is shown as changed files rather than as Git's own printout.
 */
export function parseGitPatch(text: string): GitPatch {
  const first = text.startsWith('diff --git ') ? 0 : text.indexOf('\ndiff --git ')
  const preface = first < 0 ? text : text.slice(0, first)
  const chunks = first < 0 ? [] : text.slice(first === 0 ? 0 : first + 1).split(/\n(?=diff --git )/)
  const oid = /^commit ([a-f0-9]{7,64})/m.exec(preface)?.[1]
  let commit: GitPatch['commit'] = null
  if (oid) {
    // The message is the indented block after the headers, up to the `---` that starts the file summary.
    const message = preface
      .split('\n')
      .filter((line) => line.startsWith('    '))
      .map((line) => line.slice(4))
    commit = {
      oid,
      author: /^Author:\s+(.*?)(?: <[^>]*>)?$/m.exec(preface)?.[1] ?? '',
      date: /^AuthorDate:\s+(.*)$/m.exec(preface)?.[1] ?? '',
      subject: message[0] ?? '',
      body: message.slice(1).join('\n').trim(),
    }
  }
  return { commit, files: chunks.flatMap((chunk) => parseFile(chunk) ?? []) }
}
