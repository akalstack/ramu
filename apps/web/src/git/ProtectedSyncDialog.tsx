import { useEffect, useState } from 'react'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'

type Entry = { repoName: string; branch: string }
type Request = { entries: Entry[]; resolve: (approved: boolean) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

export function confirmProtectedSync(entries: Entry[]): Promise<boolean> {
  if (active) throw new Error(t('Review the pending protected branch confirmation first.'))
  if (!listener) throw new Error(t('The sync confirmation dialog is unavailable.'))
  return new Promise((resolve) => {
    active = { entries, resolve }
    listener!(active)
  })
}

export function ProtectedSyncDialog() {
  useLanguage()
  const [request, setRequest] = useState<Request | null>(null)
  useEffect(() => {
    listener = setRequest
    return () => {
      listener = null
      active?.resolve(false)
      active = null
    }
  }, [])
  const finish = (approved: boolean) => {
    // Resolve before clearing: the React Compiler folds a `const current = active` alias into a read after `active = null`.
    active?.resolve(approved)
    active = null
    setRequest(null)
  }
  if (!request) return null
  return (
    <Dialog
      title={t('Push to a protected branch?')}
      confirmLabel={t('Sync anyway')}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    >
      <p>{t('These repositories are on a default or protected branch and have commits to push:')}</p>
      <ul className="m-0 pl-4 list-disc">
        {request.entries.map((entry, index) => (
          <li key={index}>
            <strong>{entry.repoName}</strong> · {entry.branch}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
