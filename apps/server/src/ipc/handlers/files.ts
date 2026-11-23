import { rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { editorConfigFor } from '../../workspace/editorconfig'
import { resolveFileLink, withheldPath } from '../../workspace/fileLinks'
import { HOST_FILES_REPO } from '@ramu/shared/workspace/fileLinks'
import * as files from '../../workspace/files'
import * as git from '../../workspace/git'
import {
  TRANSFER_CHUNK_BYTES,
  MAX_TRANSFER_BYTES,
  TransferInbox,
  downloadsFolder,
  readTransferChunk,
  transferManifest,
} from '../../workspace/transfer'
import { lockCheckout } from '../helpers'
import type { ModelViewerLabels } from '@ramu/shared/interactive'
import { modelViewerHtml } from '../../interactive/modelViewer'
import { id, modelViewerLabels, relPath } from '../schemas'
import type { HandlerContext, RegisterHandlers } from '../types'

const MAX_QUICK_OPEN_FILES = 50_000
const droppedPaths = z.string().min(1).max(4096)
const transferSource = z.union([
  z.object({ taskId: id, repoId: id, paths: z.array(relPath.min(1)).min(1).max(100) }).strict(),
  z.object({ paths: z.array(droppedPaths).min(1).max(100) }).strict(),
])
const transferTarget = z.union([
  z.object({ taskId: id, repoId: id, dir: relPath }).strict(),
  z.object({ downloads: z.literal(true) }).strict(),
])
const transferWrite = z
  .object({
    root: z.number().int().min(0).max(99),
    path: z.string().min(1).max(4096),
    kind: z.enum(['file', 'dir', 'link']),
    mode: z.number().int().min(0).max(0o777),
    target: z.string().min(1).max(4096).optional(),
    offset: z.number().int().min(0).max(MAX_TRANSFER_BYTES),
    // A gzipped chunk is never larger than the raw one it replaced; base64 adds a third.
    data: z.string().max(Math.ceil((TRANSFER_CHUNK_BYTES * 4) / 3) + 4),
    gzip: z.boolean(),
  })
  .strict()

/** Runs a mutation on one entry's checkout while holding that checkout's lock. */
const inCheckout = <T>(ctx: HandlerContext, taskId: string, repoId: string, fn: (cwd: string) => Promise<T>) => {
  const cwd = ctx.cwdOf(taskId, repoId)
  return lockCheckout(ctx, cwd, () => fn(cwd))
}

/** Reading, writing and managing files inside a task's checkouts. */
export const registerFileHandlers: RegisterHandlers = (ctx) => {
  const { host, workspace, cwdOf, lock } = ctx
  /**
   * The editor's reads and saves also open a file a thread linked outside its repositories, as the host's own user can,
   * and the folders around it list read-only. Creating, moving and deleting stay inside the thread's folders.
   */
  const editorCwdOf = (taskId: string, repoId: string, path: string) => {
    if (repoId !== HOST_FILES_REPO) return cwdOf(taskId, repoId)
    workspace.projectIdOf(taskId)
    if (sep !== '/' || withheldPath(resolve('/', path), withheld()))
      throw new Error('This file is outside the folders a thread can open.')
    return '/'
  }
  const withheld = () => [...workspace.managedFolders(), host.userData]
  /** Folders beside an outside file list read-only, without the folders Ramu keeps to itself. */
  const listedCwdOf = (taskId: string, repoId: string, path: string) =>
    repoId === HOST_FILES_REPO ? editorCwdOf(taskId, repoId, path) : cwdOf(taskId, repoId)
  const visibleEntries = <T extends { path: string }>(repoId: string, entries: T[]) => {
    if (repoId !== HOST_FILES_REPO) return entries
    const roots = withheld()
    return entries.filter((entry) => !withheldPath(resolve('/', entry.path), roots))
  }
  /**
   * Dropped items are absolute paths, so any caller could name Ramu's own data (its database, the browser's cookies) or
   * a folder holding it. Those are never copied out; Ramu's data stays reachable only through the calls that guard it.
   */
  const outsideRamuData = (paths: string[]) => {
    for (const path of paths) {
      const absolute = resolve(path)
      if (withheldPath(absolute, [host.userData]) || withheldPath(host.userData, [absolute]))
        throw new Error('Ramu’s own data folder cannot be copied.')
    }
    return paths
  }
  const inbox = new TransferInbox()
  /** The chosen items of a copy, as absolute paths. Project items stay inside their checkout. */
  const sourceRoots = (source: z.infer<typeof transferSource>): Promise<string[]> => {
    if (!('taskId' in source)) return Promise.resolve(outsideRamuData(source.paths))
    const cwd = cwdOf(source.taskId, source.repoId)
    return Promise.all(
      source.paths.map(async (path) => {
        const absolute = await files.resolveEntryInRoot(cwd, path)
        if (absolute === cwd) throw new Error('Choose files or folders inside the project.')
        return absolute
      }),
    )
  }
  return {
    'files.explorerBindings': { args: z.tuple([id]), run: (context: string) => workspace.explorerBindings(context) },
    'files.browse': {
      args: z.tuple([id, id, relPath, z.string().min(1).max(8192).optional()]),
      run: async (context: string, repo: string, path: string, cursor?: string) => {
        const page = await files.browseDirectory(listedCwdOf(context, repo, path), path, cursor)
        return { ...page, entries: visibleEntries(repo, page.entries) }
      },
    },
    'files.create': {
      args: z.tuple([id, id, relPath, z.enum(['file', 'dir'])]),
      run: (t: string, r: string, path: string, kind: 'file' | 'dir') =>
        inCheckout(ctx, t, r, (cwd) => files.createEntry(cwd, path, kind)),
    },
    'files.rename': {
      args: z.tuple([id, id, relPath, relPath]),
      run: (t: string, r: string, path: string, destination: string) =>
        inCheckout(ctx, t, r, (cwd) => files.renameEntry(cwd, path, destination)),
    },
    'files.copy': {
      args: z.tuple([id, id, relPath, relPath]),
      run: (t: string, r: string, path: string, destination: string) =>
        inCheckout(ctx, t, r, (cwd) => files.copyEntry(cwd, path, destination)),
    },
    'files.import': {
      args: z.tuple([id, id, relPath, z.array(droppedPaths).min(1).max(100)]),
      run: (t: string, r: string, dir: string, paths: string[]) =>
        inCheckout(ctx, t, r, (cwd) => files.importEntries(cwd, dir, outsideRamuData(paths))),
    },
    'files.transfer.manifest': {
      args: z.tuple([transferSource]),
      run: async (source: z.infer<typeof transferSource>) => transferManifest(await sourceRoots(source)),
    },
    'files.transfer.read': {
      args: z.tuple([
        transferSource,
        z.number().int().min(0).max(99),
        z.string().min(1).max(4096),
        z.number().int().min(0),
      ]),
      run: async (source: z.infer<typeof transferSource>, root: number, path: string, offset: number) => {
        const absolute = (await sourceRoots(source))[root]
        if (!absolute) throw new Error('That file is not part of this copy.')
        return readTransferChunk(absolute, path, offset)
      },
    },
    'files.transfer.begin': { args: z.tuple([]), run: async () => ({ id: await inbox.begin() }) },
    'files.transfer.write': {
      args: z.tuple([z.string().uuid(), transferWrite]),
      run: (transfer: string, write: z.infer<typeof transferWrite>) => inbox.write(transfer, write),
    },
    'files.transfer.finish': {
      args: z.tuple([z.string().uuid(), transferTarget]),
      run: async (transfer: string, target: z.infer<typeof transferTarget>) => {
        if ('downloads' in target) {
          const folder = await downloadsFolder()
          const saved = await lock.run(`file:${folder}`, () => inbox.finish(transfer, folder, ''))
          // Downloads go to the person at this computer, so show them where; a host with no desktop just skips it.
          if (saved[0]) await host.native('reveal', join(folder, saved[0])).catch(() => {})
          return saved
        }
        return inCheckout(ctx, target.taskId, target.repoId, (cwd) => inbox.finish(transfer, cwd, target.dir))
      },
    },
    'files.transfer.cancel': { args: z.tuple([z.string().uuid()]), run: (transfer: string) => inbox.cancel(transfer) },
    'files.dropInfo': {
      args: z.tuple([z.array(droppedPaths).max(100)]),
      run: (paths: string[]) => files.describeDroppedPaths(paths),
    },
    // Deletion is permanent: it works the same on this computer and on a remote one, with no system Trash involved.
    'files.delete': {
      args: z.tuple([id, id, relPath]),
      run: (t: string, r: string, path: string) =>
        inCheckout(ctx, t, r, async (cwd) => {
          const absolute = await files.resolveEntryInRoot(cwd, path)
          if (absolute === cwd) throw new Error('The repository root cannot be deleted.')
          await rm(absolute, { recursive: true, force: true })
        }),
    },
    'files.writer': {
      args: z.tuple([id, id]),
      run: (t: string, r: string) => ({ active: !!ctx.agents.activeWriter([cwdOf(t, r)]) }),
    },
    'files.reveal': {
      args: z.tuple([id, id, relPath]),
      run: async (t: string, r: string, path: string) => {
        await host.native('reveal', await files.resolveInRoot(editorCwdOf(t, r, path), path))
      },
    },
    'files.list': {
      args: z.tuple([id, id, relPath]),
      run: async (taskId: string, repoId: string, path: string) =>
        visibleEntries(repoId, await files.listDir(listedCwdOf(taskId, repoId, path), path)),
    },
    'files.read': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readText(editorCwdOf(taskId, repoId, path), path),
    },
    'files.editorconfig': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => editorConfigFor(editorCwdOf(taskId, repoId, path), path),
    },
    'files.image': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readImage(editorCwdOf(taskId, repoId, path), path),
    },
    'files.media': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readMedia(editorCwdOf(taskId, repoId, path), path),
    },
    'files.modelViewer': {
      args: z.tuple([id, id, relPath, modelViewerLabels]),
      run: async (taskId: string, repoId: string, path: string, labels: ModelViewerLabels) =>
        modelViewerHtml(await files.readModel(editorCwdOf(taskId, repoId, path), path), labels),
    },
    'files.write': {
      args: z.tuple([id, id, relPath, z.string().max(files.MAX_EDITABLE_BYTES), z.string().max(128).nullable()]),
      run: (taskId: string, repoId: string, path: string, content: string, baseHash: string | null) => {
        const cwd = editorCwdOf(taskId, repoId, path)
        return lock.run(`file:${cwd}/${path}`, async () => {
          const saved = await files.writeText(cwd, path, content, baseHash)
          if (saved.ok) ctx.reviews.personWrote(join(cwd, path))
          return saved
        })
      },
    },
    'files.resolveLink': {
      args: z.tuple([id, z.string().min(1).max(8192), z.object({ folders: z.boolean().optional() }).optional()]),
      run: (taskId: string, href: string, options?: { folders?: boolean }) =>
        resolveFileLink(workspace, taskId, href, options, [host.userData]),
    },
    'files.all': {
      args: z.tuple([id]),
      run: async (taskId: string) => {
        // Quick open and file mentions include plain chat folders as well as repositories.
        const out: { repoId: string; path: string }[] = []
        for (const b of workspace.fileBindings(taskId)) {
          if (b.setupState !== 'ready') continue
          for (const path of await (b.folderOnly ? files.listFolderFiles(b.cwd) : git.listFiles(b.cwd))) {
            out.push({ repoId: b.repoId, path })
            if (out.length >= MAX_QUICK_OPEN_FILES) return out
          }
        }
        return out
      },
    },
  }
}
