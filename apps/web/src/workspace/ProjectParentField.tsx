import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { folderName } from '@ramu/shared/workspace/hostFolders'
import { Button } from '@/components/desktop-button'
import { invokerFor } from '../ipc'
import { t, useLanguage } from '../i18n'
import { pickHostFolder } from './addProject'

/**
 * Where a new project's folder goes on `host`: the folder the person last chose there, from any device or approval
 * card, else the host's usual place. `chosen` is what to send; null leaves the choice to the host.
 */
export function useProjectParent(host: string) {
  const [chosen, setChosen] = useState<string | null>(null)
  const fallback = useQuery({
    queryKey: ['ipc', host, 'projects.defaultParent'],
    queryFn: () => invokerFor(host)('projects.defaultParent'),
    // The host remembers a choice made on another device or in a thread, so each opening asks again.
    staleTime: 0,
  })
  const parent = chosen ?? fallback.data ?? null
  const change = async () => {
    const dir = await pickHostFolder(host, { purpose: 'parent', ...(parent ? { start: parent } : {}) })
    if (dir) setChosen(dir)
  }
  return { parent, chosen, change }
}

/** The new project's location with a Change… that opens the host folder browser there. */
export function ProjectParentField({
  location,
  disabled,
}: {
  location: ReturnType<typeof useProjectParent>
  disabled?: boolean
}) {
  useLanguage()
  return (
    <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
      <FolderOpen size={13} className="flex-none" aria-hidden />
      <span className="truncate" title={location.parent ?? undefined}>
        {location.parent ? t('In {0}', { '0': folderName(location.parent) }) : t('In the usual folder')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        disabled={disabled}
        aria-label={t('Change where the project goes')}
        onClick={() => void location.change()}
      >
        {t('Change…')}
      </Button>
    </span>
  )
}
