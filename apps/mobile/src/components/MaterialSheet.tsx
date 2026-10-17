import type { ReactNode } from 'react'

/** Android's Material 3 modal bottom sheet. Other platforms never render it (see MaterialSheet.android.tsx). */
export function MaterialSheet(_props: { open: boolean; onClose: () => void; children: ReactNode }): ReactNode {
  return null
}
