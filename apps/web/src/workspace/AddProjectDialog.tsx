import { t, useLanguage } from '../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { useEffect, useState } from 'react'
import { Dialog } from '../Menu'
import { onRepoChoice, type RepoChoice } from './addProject'

const name = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Shown when a folder holds several repositories: every one starts ticked, and the user unticks any to leave out. */
export function AddProjectDialog() {
  useLanguage()
  const [request, setRequest] = useState<RepoChoice | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(
    () =>
      onRepoChoice((next) => {
        setSelected(new Set(next.repos))
        setRequest(next)
      }),
    [],
  )
  if (!request) return null
  const close = (result: string[] | null) => {
    const { resolve } = request
    setRequest(null)
    resolve(result)
  }
  const toggle = (repo: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(repo)) next.add(repo)
      return next
    })
  const chosen = request.repos.filter((repo) => selected.has(repo))
  const all = chosen.length === request.repos.length
  return (
    <Dialog
      title={t('Add {0}', { '0': request.name })}
      confirmLabel={
        chosen.length
          ? t('Add {0} of {1}', { '0': chosen.length, '1': request.repos.length })
          : t('Select a repository')
      }
      confirmDisabled={!chosen.length}
      footerLeading={
        <label className="mr-auto flex items-center gap-2 text-caption text-muted-foreground cursor-default">
          <Checkbox
            aria-label={t('Select all')}
            checked={all}
            indeterminate={!all && chosen.length > 0}
            onCheckedChange={() => setSelected(new Set(all ? [] : request.repos))}
          />
          {t('Select all')}
        </label>
      }
      onCancel={() => close(null)}
      onConfirm={() => close(chosen)}
    >
      <p className="muted text-muted-foreground small text-caption m-[0_0_8px]">
        {t("This folder contains several repositories. Untick any you don't want in the project.")}
      </p>
      <div className="flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
        {request.repos.map((repo) => (
          <label
            key={repo}
            className="[&:hover]:bg-hover flex items-center gap-2.5 min-h-[32px] p-[2px_6px] rounded-(--radius-s) cursor-default"
            title={repo}
          >
            <Checkbox aria-label={name(repo)} checked={selected.has(repo)} onCheckedChange={() => toggle(repo)} />
            <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{name(repo)}</span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}
