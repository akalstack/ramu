import { ContentSkeleton } from '@/components/content-skeleton'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/desktop-button'
import { ArchiveRestore, Copy, Plus, Trash2 } from 'lucide-react'
import type { GitStash, RepositoryBinding } from '@ramu/shared/types'
import { t } from '../../i18n'
import { StashRow } from '../StashRow'
import { ICON_BUTTON } from './classes'

/** Saved stashes with apply, pop and delete, plus the button to stash current changes. */
export function StashesPane({
  taskId,
  binding,
  stashes,
  loading,
  busy,
  canStash,
  onApply,
  onPop,
  onDrop,
  onStash,
}: {
  taskId: string
  binding: RepositoryBinding
  stashes: GitStash[]
  loading: boolean
  busy: boolean
  canStash: boolean
  onApply: (stash: GitStash) => void
  onPop: (stash: GitStash) => void
  onDrop: (stash: GitStash) => void
  onStash: () => void
}) {
  return (
    <TabsContent value="stashes" className="git-pane git-stashes">
      <OverlayScrollArea className="git-history">
        {stashes.map((stash) => (
          <StashRow key={`${binding.repoId}:${stash.oid}`} taskId={taskId} binding={binding} stash={stash}>
            <span className="stash-actions">
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON}
                disabled={busy}
                aria-label={t('Apply {0}', { '0': stash.subject })}
                title={t('Apply (keep the stash)')}
                onClick={() => onApply(stash)}
              >
                <Copy size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON}
                disabled={busy}
                aria-label={t('Pop {0}', { '0': stash.subject })}
                title={t('Pop (apply and remove)')}
                onClick={() => onPop(stash)}
              >
                <ArchiveRestore size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON}
                disabled={busy}
                aria-label={t('Delete {0}', { '0': stash.subject })}
                title={t('Delete stash')}
                onClick={() => onDrop(stash)}
              >
                <Trash2 size={13} />
              </Button>
            </span>
          </StashRow>
        ))}
        {loading && <ContentSkeleton />}
        {!loading && !stashes.length && (
          <p className="muted text-muted-foreground small text-caption git-empty m-[2px_0] p-1.5 text-caption leading-[1.5]">
            {t('No saved stashes.')}
          </p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="git-stash-new w-full justify-start"
          disabled={busy || !canStash}
          title={canStash ? undefined : t('Nothing to stash')}
          onClick={onStash}
        >
          <Plus size={13} />
          {t('Stash changes…')}
        </Button>
      </OverlayScrollArea>
    </TabsContent>
  )
}
