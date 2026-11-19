import type { UndoPreview } from '@ramu/shared/types'

type Invoke = (method: string, ...args: unknown[]) => Promise<unknown>

/**
 * Edit from here, as on the desktop: asks first (offering to revert the files the agent changed since, when any can
 * be), then reverts if chosen and rewinds the thread to before the message. Returns what happened, so the screen only
 * has to put the message back in the box.
 */
export async function editFromHere({
  invoke,
  sessionId,
  seq,
  confirm,
  stillWritable,
}: {
  invoke: Invoke
  sessionId: string
  seq: number
  /** Asks the person; `revertable` is how many changed files can be put back. */
  confirm: (revertable: number) => Promise<'keep' | 'revert' | null>
  /** Checked again after the question, since access can change while it is open. */
  stillWritable: () => boolean
}): Promise<'rewound' | 'cancelled'> {
  const preview = (await invoke('reviews.chatUndoPreview', sessionId, seq).catch(() => null)) as UndoPreview | null
  const ready = preview?.files.filter((file) => file.status === 'ready') ?? []
  const choice = await confirm(ready.length)
  if (!choice || !stillWritable()) return 'cancelled'
  if (choice === 'revert' && preview && ready.length)
    await invoke(
      'reviews.chatUndoApply',
      preview.token,
      ready.map((file) => file.fileId),
    )
  await invoke('agent.rewind', sessionId, seq)
  return 'rewound'
}
