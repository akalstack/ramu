import type { ReactNode } from 'react'
import { View } from 'react-native'
import { font, space } from '../theme'
import { T } from './ui'

/** Title with its explanation underneath; the left half of every settings row. */
export function RowLabel({ title, help }: { title: string; help?: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T weight="500" style={{ lineHeight: 22 }}>
        {title}
      </T>
      {help ? (
        <T size={font.caption} tone="muted" style={{ lineHeight: 18 }}>
          {help}
        </T>
      ) : null}
    </View>
  )
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s, lineHeight: 18 }}>
      {children}
    </T>
  )
}
