import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileText,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Scissors,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { invoke } from '../../ipc'
import type { MenuEntry } from '../../Menu'
import type { useWorkspace } from '../../workspace'
import { baseName, parentOf } from './paths'
import { shared, type TreeAction } from './shared'

type Ctx = {
  ws: ReturnType<typeof useWorkspace>
  taskId: string
  binding: RepositoryBinding
  /** The right-clicked entry, and the whole selection when it is part of a multi-selection. */
  target: DirEntry
  targets: DirEntry[]
  multi: boolean
  busy: boolean
  pasteDir: string
  setClip: (paths: string[], cut: boolean) => void
  begin: (action: TreeAction) => void
  deletePicked: (clicked?: DirEntry) => void
  pasteInto: (dir: string, source?: typeof shared.clip) => Promise<void>
  copy: (text: string) => Promise<void>
  fail: (reason: unknown) => void
}

/** Context menu of a tree row: a multi-selection gets bulk actions, a single entry the full set. */
export function explorerMenuEntries({
  ws,
  taskId,
  binding,
  target,
  targets,
  multi,
  busy,
  pasteDir,
  setClip,
  begin,
  deletePicked,
  pasteInto,
  copy,
  fail,
}: Ctx): MenuEntry[] {
  return multi
    ? [
        {
          key: 'cut',
          label: (
            <>
              <Scissors size={14} />
              {t('Cut ')}
              {targets.length} {t(' items')}
            </>
          ),
          onSelect: () =>
            setClip(
              targets.map((entry) => entry.path),
              true,
            ),
        },
        {
          key: 'copy',
          label: (
            <>
              <Copy size={14} />
              {t('Copy ')}
              {targets.length} {t(' items')}
            </>
          ),
          onSelect: () =>
            setClip(
              targets.map((entry) => entry.path),
              false,
            ),
        },
        {
          key: 'copy-paths',
          label: t('Copy paths'),
          onSelect: () => void copy(targets.map((entry) => `${binding.cwd}/${entry.path}`).join('\n')),
        },
        {
          key: 'copy-relative',
          label: t('Copy relative paths'),
          onSelect: () => void copy(targets.map((entry) => entry.path).join('\n')),
        },
        { key: 'separator', separator: true as const },
        {
          key: 'delete',
          label: (
            <>
              <Trash2 size={14} />
              {t('Delete {0} items…', { '0': targets.length })}
            </>
          ),
          disabled: busy,
          danger: true,
          onSelect: () => deletePicked(target),
        },
      ]
    : [
        ...(target.kind === 'dir'
          ? [
              {
                key: 'new-file',
                label: (
                  <>
                    <FilePlus size={14} />
                    {t('New file…')}
                  </>
                ),
                disabled: busy,
                onSelect: () => begin({ type: 'create', parent: target.path, kind: 'file' }),
              },
              {
                key: 'new-folder',
                label: (
                  <>
                    <FolderPlus size={14} />
                    {t('New folder…')}
                  </>
                ),
                disabled: busy,
                onSelect: () => begin({ type: 'create', parent: target.path, kind: 'dir' }),
              },
              {
                key: 'terminal',
                label: (
                  <>
                    <SquareTerminal size={14} />
                    {t('Open terminal in ')}
                    {binding.folderOnly ? 'folder' : t('repository')}
                  </>
                ),
                onSelect: () => ws.openView(taskId, { kind: 'terminal', repoId: binding.repoId }),
              },
            ]
          : [
              {
                key: 'open',
                label: (
                  <>
                    <FileText size={14} />
                    {t('Open file')}
                  </>
                ),
                onSelect: () => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: target.path }),
              },
            ]),
        { key: 'separator-edit', separator: true as const },
        ...(target.path
          ? [
              {
                key: 'cut',
                label: (
                  <>
                    <Scissors size={14} />
                    {t('Cut')}
                  </>
                ),
                onSelect: () => setClip([target.path], true),
              },
              {
                key: 'copy',
                label: (
                  <>
                    <Copy size={14} />
                    {t('Copy')}
                  </>
                ),
                onSelect: () => setClip([target.path], false),
              },
            ]
          : []),
        {
          key: 'paste',
          label: (
            <>
              <ClipboardPaste size={14} />
              {t('Paste')}
              {shared.clip
                ? ` ${shared.clip.paths.length === 1 ? baseName(shared.clip.paths[0]!) : `${shared.clip.paths.length} items`}`
                : ''}
            </>
          ),
          disabled: busy || !shared.clip || shared.clip.repoId !== binding.repoId,
          onSelect: () => void pasteInto(pasteDir),
        },
        ...(target.path
          ? [
              {
                key: 'duplicate',
                label: (
                  <>
                    <CopyPlus size={14} />
                    {t('Duplicate')}
                  </>
                ),
                disabled: busy,
                onSelect: () =>
                  void pasteInto(parentOf(target.path), {
                    taskId,
                    repoId: binding.repoId,
                    paths: [target.path],
                    cut: false,
                  }),
              },
            ]
          : []),
        { key: 'separator-paths', separator: true as const },
        {
          key: 'reveal',
          label: (
            <>
              <FolderOpen size={14} />
              {t('Reveal in Finder')}
            </>
          ),
          onSelect: () => {
            void invoke('files.reveal', taskId, binding.repoId, target.path).catch(fail)
          },
        },
        {
          key: 'copy-path',
          label: (
            <>
              <Copy size={14} />
              {t('Copy path')}
            </>
          ),
          onSelect: () => void copy(target.path ? `${binding.cwd}/${target.path}` : binding.cwd),
        },
        { key: 'copy-relative', label: t('Copy relative path'), onSelect: () => void copy(target.path || '.') },
        ...(target.path
          ? [
              { key: 'separator', separator: true as const },
              {
                key: 'rename',
                label: (
                  <>
                    <Pencil size={14} />
                    {t('Rename…')}
                  </>
                ),
                disabled: busy,
                onSelect: () => begin({ type: 'rename', entry: target }),
              },
              {
                key: 'delete',
                label: (
                  <>
                    <Trash2 size={14} />
                    {t('Delete…')}
                  </>
                ),
                disabled: busy,
                danger: true,
                onSelect: () => deletePicked(target),
              },
            ]
          : []),
      ]
}
