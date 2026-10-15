import { rm } from 'node:fs/promises'
import { z } from 'zod'
import { editorConfigFor } from '../../workspace/editorconfig'
import { resolveFileLink } from '../../workspace/fileLinks'
import * as files from '../../workspace/files'
import * as git from '../../workspace/git'
import { lockCheckout } from '../helpers'
import { id, relPath } from '../schemas'
import type { HandlerContext, RegisterHandlers } from '../types'

const MAX_QUICK_OPEN_FILES = 50_000
const droppedPaths = z.string().min(1).max(4096)

/** Runs a mutation on one entry's checkout while holding that checkout's lock. */
const inCheckout = <T>(ctx: HandlerContext, taskId: string, repoId: string, fn: (cwd: string) => Promise<T>) => {
  const cwd = ctx.cwdOf(taskId, repoId)
  return lockCheckout(ctx, cwd, () => fn(cwd))
}

/** Reading, writing and managing files inside a task's checkouts. */
export const registerFileHandlers: RegisterHandlers = (ctx) => {
  const { host, workspace, cwdOf, lock } = ctx
  return {
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
        inCheckout(ctx, t, r, (cwd) => files.importEntries(cwd, dir, paths)),
    },
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
    'files.reveal': {
      args: z.tuple([id, id, relPath]),
      run: async (t: string, r: string, path: string) => {
        await host.native('reveal', await files.resolveInRoot(cwdOf(t, r), path))
      },
    },
    'files.list': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.listDir(cwdOf(taskId, repoId), path),
    },
    'files.read': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readText(cwdOf(taskId, repoId), path),
    },
    'files.editorconfig': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => editorConfigFor(cwdOf(taskId, repoId), path),
    },
    'files.image': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readImage(cwdOf(taskId, repoId), path),
    },
    'files.media': {
      args: z.tuple([id, id, relPath]),
      run: (taskId: string, repoId: string, path: string) => files.readMedia(cwdOf(taskId, repoId), path),
    },
    'files.write': {
      args: z.tuple([id, id, relPath, z.string().max(files.MAX_EDITABLE_BYTES), z.string().max(128).nullable()]),
      run: (taskId: string, repoId: string, path: string, content: string, baseHash: string | null) => {
        const cwd = cwdOf(taskId, repoId)
        return lock.run(`file:${cwd}/${path}`, () => files.writeText(cwd, path, content, baseHash))
      },
    },
    'files.resolveLink': {
      args: z.tuple([id, z.string().min(1).max(8192)]),
      run: (taskId: string, href: string) => resolveFileLink(workspace, taskId, href),
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
