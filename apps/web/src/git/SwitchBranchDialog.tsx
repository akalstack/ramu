import { useEffect, useState } from 'react'
import type { RamuBridge } from '@ramu/shared/api'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'

type Request = { branch: string; resolve: (wait: boolean) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

function confirmSwitchWhenIdle(branch: string): Promise<boolean> {
  if (active || !listener) return Promise.resolve(false)
  return new Promise((resolve) => {
    active = { branch, resolve }
    listener!(active)
  })
}

/**
 * Switches a checkout's branch. While threads work there it asks first, then waits for them to finish (new turns
 * there wait too) instead of refusing, since a switch rewrites files under every thread in the checkout.
 */
export async function switchBranch(
  hostInvoke: RamuBridge['invoke'],
  taskId: string,
  repoId: string,
  branch: string,
): Promise<void> {
  const { active: busy } = await hostInvoke('files.writer', taskId, repoId).catch(() => ({ active: false }))
  if (!busy) return hostInvoke('git.checkout', taskId, repoId, branch)
  if (!(await confirmSwitchWhenIdle(branch))) return
  return hostInvoke('git.checkout', taskId, repoId, branch, { whenIdle: true })
}

export function SwitchBranchDialog() {
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
  const finish = (wait: boolean) => {
    // Resolve before clearing: the React Compiler folds a `const current = active` alias into a read after `active = null`.
    active?.resolve(wait)
    active = null
    setRequest(null)
  }
  if (!request) return null
  return (
    <Dialog
      title={t('Switch when threads finish?')}
      confirmLabel={t('Switch when they finish')}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    >
      <p>
        {t(
          'Threads are working in this checkout. Ramu switches to {0} as soon as they finish, and new messages there wait until it has.',
          { 0: request.branch },
        )}
      </p>
    </Dialog>
  )
}
