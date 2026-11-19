import type { ReactNode } from 'react'
import { useViewOnly } from '../composer/useViewOnly'
import { t } from '../i18n'

/** Keep editors mounted so an access change does not discard local rename/commit drafts. */
export function WorkspaceAccessBoundary({ children }: { children: ReactNode }) {
  const viewOnly = useViewOnly()
  return (
    <>
      {viewOnly && (
        <p role="status" className="m-0 p-3 text-control text-muted-foreground">
          {t(
            'This device can view threads, but cannot access files or Git. Ask the host owner to pair it with full access.',
          )}
        </p>
      )}
      <div hidden={viewOnly} inert={viewOnly} className="contents" style={{ display: viewOnly ? 'none' : undefined }}>
        {children}
      </div>
    </>
  )
}
