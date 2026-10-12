import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { resolveEntryInRoot } from './files'
import type { ChangeFile, UndoFile, UndoPreview } from '../shared/types'
const exec = promisify(execFile)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
interface PlanFile extends UndoFile { absolute: string; root: string; expected: string | null; mode: number }
interface Plan extends UndoPreview { files: PlanFile[] }
/** Previews are private, short-lived compare-and-swap plans; backups stay in the profile. */
export class RunUndo {
  private plans = new Map<string, Plan>()
  private applying = false
  constructor(private readonly folder: string) {}
  interrupted(): { reviewId: string; backup: string }[] {
    if (!existsSync(this.folder)) return []
    return readdirSync(this.folder).flatMap((name) => {
      try {
        const backup = join(this.folder, name, 'journal.json'), journal = JSON.parse(readFileSync(backup, 'utf8'))
        return journal.state === 'applying' ? [{ reviewId: String(journal.reviewId), backup }] : []
      } catch { return [] }
    })
  }
  private async location(root: string, path: string): Promise<string> {
    const absolute = await resolveEntryInRoot(root, path)
    // Do not replace symlinks or walk through them, even when they currently stay inside the root.
    let cursor = root
    for (const part of relative(root, absolute).split(/[\\/]/)) {
      cursor = join(cursor, part)
      const info = await lstat(cursor).catch((e) => { if (e.code === 'ENOENT') return null; throw e })
      if (info?.isSymbolicLink()) throw new Error('A symlink is in this file path')
    }
    return absolute
  }
  private async current(absolute: string): Promise<{ content: string; hash: string; mode: number } | null> {
    const info = await lstat(absolute).catch((e) => { if (e.code === 'ENOENT') return null; throw e })
    if (!info) return null
    if (!info.isFile() || info.size > 1000000) throw new Error('Current file is not a small text file')
    const bytes = await readFile(absolute)
    if (bytes.includes(0) || bytes.toString('utf8').includes('\ufffd')) throw new Error('Current file is binary')
    return { content: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex'), mode: info.mode & 0o777 }
  }
  async preview(reviewId: string, files: ChangeFile[], roots: { repoId: string; cwd: string }[], undoneIds: string[] = [], blocked: Record<string, string> = {}): Promise<UndoPreview> {
    for (const [token, plan] of this.plans) if (plan.expiresAt < Date.now()) this.plans.delete(token)
    const plan: Plan = { token: randomUUID(), reviewId, expiresAt: Date.now() + 600000, files: [] }
    await mkdir(this.folder, { recursive: true, mode: 0o700 })
    for (const file of files) {
      const entry: PlanFile = { fileId: file.id, path: file.path, repoName: file.repoName, status: 'unavailable', reason: '', currentContent: '', resultContent: '', remove: false, absolute: '', root: '', expected: null, mode: 0o644 }
      plan.files.push(entry)
      if (Object.hasOwn(blocked, file.id)) { entry.reason = blocked[file.id]!; continue }
      if (undoneIds.includes(file.id)) { entry.status = 'unchanged'; entry.reason = 'Already undone'; continue }
      if (file.binary) { entry.reason = 'Binary or large files require manual review'; continue }
      try {
        const root = roots.find((r) => r.repoId === file.repoId)?.cwd
        if (!root) throw new Error('Working directory is unavailable')
        entry.root = root; entry.absolute = await this.location(root, file.path)
        const current = await this.current(entry.absolute)
        entry.expected = current?.hash ?? null; entry.mode = current?.mode ?? file.oldMode ?? 0o644; entry.currentContent = current?.content ?? ''
        entry.resultContent = file.oldContent; entry.remove = file.status === 'added'
        if (file.status === 'added') {
          if (!current) { entry.status = 'unchanged'; entry.reason = 'File is already absent' }
          else if (current.hash !== (file.newHash ?? digest(file.newContent))) { entry.status = 'conflict'; entry.reason = 'The added file has later edits; it will not be removed' }
          else { entry.status = 'ready'; entry.reason = 'Remove the file added during this run' }
        } else if (file.status === 'deleted') {
          if (!current) { entry.status = 'ready'; entry.reason = 'Restore the deleted file' }
          else if (current.hash === (file.oldHash ?? digest(file.oldContent))) { entry.status = 'unchanged'; entry.reason = 'Original content is already restored' }
          else { entry.status = 'conflict'; entry.reason = 'A different file now exists at this path' }
        } else if (!current) { entry.status = 'conflict'; entry.reason = 'File was removed after this run' }
        else if (current.hash === (file.oldHash ?? digest(file.oldContent))) { entry.status = 'unchanged'; entry.reason = 'Original content is already restored' }
        else if (current.hash === (file.newHash ?? digest(file.newContent))) { entry.status = 'ready'; entry.reason = 'Restore the content from before this run' }
        else {
          const dir = join(this.folder, `merge-${randomUUID()}`); await mkdir(dir, { mode: 0o700 })
          try {
            await Promise.all([writeFile(join(dir, 'current'), current.content), writeFile(join(dir, 'after'), file.newContent), writeFile(join(dir, 'before'), file.oldContent)])
            try { const result = await exec('git', ['merge-file', '-p', join(dir, 'current'), join(dir, 'after'), join(dir, 'before')], { maxBuffer: 4000000, timeout: 30000 }); entry.resultContent = result.stdout; entry.status = 'ready'; entry.reason = 'Undo this run while preserving later edits' }
            catch (e) { const code = (e as { code?: number }).code; if (typeof code === 'number' && code > 0 && code < 128) { entry.status = 'conflict'; entry.reason = 'Later edits overlap this run; resolve them manually' } else throw e }
          } finally { await rm(dir, { recursive: true, force: true }) }
        }
      } catch (error) { entry.status = 'unavailable'; entry.reason = error instanceof Error ? error.message : String(error) }
    }
    this.plans.set(plan.token, plan)
    return this.public(plan)
  }
  private public(plan: Plan): UndoPreview { return { token: plan.token, reviewId: plan.reviewId, expiresAt: plan.expiresAt, files: plan.files.map(({ absolute: _a, root: _r, expected: _e, mode: _m, ...f }) => f) } }
  reviewId(token: string): string { const plan = this.plans.get(token); if (!plan || plan.expiresAt < Date.now()) throw new Error('Undo preview expired. Preview again.'); return plan.reviewId }
  async apply(token: string, fileIds: string[]): Promise<{ reviewId: string; fileIds: string[] }> {
    if (this.applying) throw new Error('Another undo is in progress')
    this.applying = true
    try {
      this.reviewId(token)
      const plan = this.plans.get(token)!, selected = plan.files.filter((f) => fileIds.includes(f.fileId))
      if (!selected.length || new Set(fileIds).size !== selected.length || selected.some((f) => f.status !== 'ready')) throw new Error('Select only files ready to undo')
      // Check the whole selection before changing any file. Stale previews never write.
      for (const file of selected) {
        if (await this.location(file.root, file.path) !== file.absolute || (await this.current(file.absolute))?.hash !== (file.expected ?? undefined)) throw new Error(`${file.path} changed after preview. Preview again.`)
      }
      const backup = join(this.folder, plan.token); await mkdir(backup, { mode: 0o700 })
      await writeFile(join(backup, 'journal.json'), JSON.stringify({ state: 'applying', reviewId: plan.reviewId, files: selected }), { mode: 0o600 })
      this.plans.delete(token)
      const written: PlanFile[] = []
      try {
        for (const file of selected) {
          if (await this.location(file.root, file.path) !== file.absolute || (await this.current(file.absolute))?.hash !== (file.expected ?? undefined)) throw new Error(`${file.path} changed during undo`)
          if (file.remove) await rm(file.absolute)
          else { await mkdir(dirname(file.absolute), { recursive: true }); const temp = join(dirname(file.absolute), `.ramu-undo-${randomUUID()}`); try { await writeFile(temp, file.resultContent, { mode: file.mode, flag: 'wx' }); await rename(temp, file.absolute) } finally { await rm(temp, { force: true }) } }
          written.push(file)
        }
      } catch (error) {
        const conflicts: string[] = []
        for (const file of written.reverse()) {
          try {
            await this.location(file.root, file.path)
            const current = await this.current(file.absolute)
            if (current?.hash !== (file.remove ? undefined : digest(file.resultContent))) { conflicts.push(file.path); continue }
            if (file.expected === null) await rm(file.absolute, { force: true })
            else await writeFile(file.absolute, file.currentContent, { mode: file.mode })
          } catch { conflicts.push(file.path) }
        }
        await writeFile(join(backup, 'journal.json'), JSON.stringify({ state: 'failed', reviewId: plan.reviewId, error: String(error), conflicts, files: selected }), { mode: 0o600 })
        throw new Error(`${String(error)}${conflicts.length ? `. Recovery backups are retained; inspect ${conflicts.join(', ')}` : '. Applied files were restored.'}`)
      }
      await writeFile(join(backup, 'journal.json'), JSON.stringify({ state: 'completed', reviewId: plan.reviewId, files: selected }), { mode: 0o600 })
      this.plans.delete(token)
      return { reviewId: plan.reviewId, fileIds: selected.map((f) => f.fileId) }
    } finally { this.applying = false }
  }
}
