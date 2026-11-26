import { describe, expect, it } from 'vitest'
import { parseGitPatch } from '../src/gitPatch'

const SHOW = `commit 1234567890abcdef1234567890abcdef12345678
Author:     Ana Lim <ana@example.com>
AuthorDate: Thu Nov 26 10:00:00 2026 +0700
Commit:     Ana Lim <ana@example.com>
CommitDate: Thu Nov 26 10:00:00 2026 +0700

    Add the export button

    It writes a CSV of the visible rows.
---
 src/export.ts | 3 +++
 src/old.ts    | 1 -
 2 files changed, 3 insertions(+), 1 deletion(-)

diff --git a/src/export.ts b/src/export.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/export.ts
@@ -0,0 +1,3 @@
+export function rows() {
+  return []
+}
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 2222222..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const old = 1
diff --git a/src/a name.ts b/src/b name.ts
similarity index 100%
rename from src/a name.ts
rename to src/b name.ts
diff --git a/logo.png b/logo.png
index 3333333..4444444 100644
Binary files a/logo.png and b/logo.png differ
`

describe('parseGitPatch', () => {
  it('reads a commit’s author, date and message, and each file with its hunks', () => {
    const patch = parseGitPatch(SHOW)
    expect(patch.commit).toEqual({
      oid: '1234567890abcdef1234567890abcdef12345678',
      author: 'Ana Lim',
      date: 'Thu Nov 26 10:00:00 2026 +0700',
      subject: 'Add the export button',
      body: 'It writes a CSV of the visible rows.',
    })
    expect(patch.files.map((file) => [file.path, file.status, file.additions, file.deletions])).toEqual([
      ['src/export.ts', 'added', 3, 0],
      ['src/old.ts', 'removed', 0, 1],
      ['src/b name.ts', 'renamed', 0, 0],
      ['logo.png', 'modified', 0, 0],
    ])
    expect(patch.files[0]!.patch).toBe('@@ -0,0 +1,3 @@\n+export function rows() {\n+  return []\n+}')
    expect(patch.files[2]).toMatchObject({ previousPath: 'src/a name.ts', patch: null })
    expect(patch.files[3]!.patch).toBeNull()
  })

  it('reads a comparison, which has no commit, and a path Git quoted', () => {
    const patch = parseGitPatch(
      ' "caf\\303\\251.txt" | 2 +-\n 1 file changed\n\ndiff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\nindex 1..2 100644\n--- "a/caf\\303\\251.txt"\n+++ "b/caf\\303\\251.txt"\n@@ -1 +1 @@\n-old\n+new\n',
    )
    expect(patch.commit).toBeNull()
    expect(patch.files).toEqual([
      { path: 'café.txt', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' },
    ])
  })

  it('finds nothing in an empty comparison', () => {
    expect(parseGitPatch('')).toEqual({ commit: null, files: [] })
  })
})
