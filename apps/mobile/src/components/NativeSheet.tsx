import type { ReactNode } from 'react'

export interface SheetSearchProps {
  value: string
  onChangeText(value: string): void
  placeholder: string
  label?: string
  onSubmit?: () => void
}

export interface NativeSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  scroll?: boolean
  presentation?: 'sheet' | 'screen'
  search?: SheetSearchProps
  /** One level down inside the sheet: a back arrow leads the header, and Close moves to its far side. */
  onBack?: () => void
}

/** iOS resolves NativeSheet.ios.tsx; other platforms use their own sheet implementation. */
export function NativeSheet(_props: NativeSheetProps): ReactNode {
  return null
}
