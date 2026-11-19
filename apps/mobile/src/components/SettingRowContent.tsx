import type { ReactNode } from 'react'
import { View } from 'react-native'
import { font, space } from '../theme'
import { T } from './ui'

/**
 * Title with its explanation underneath; the left half of every settings row. A list entry (a skill, a plugin) passes
 * its own `description`, cut to two lines so one long entry cannot fill the screen, and its states as `help`, kept
 * whole on the line below.
 */
export function RowLabel({ title, help, description }: { title: string; help?: string; description?: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <T weight="500" numberOfLines={description === undefined ? undefined : 1} style={{ lineHeight: 22 }}>
        {title}
      </T>
      {description ? (
        <T size={font.caption} tone="muted" numberOfLines={2} style={{ lineHeight: 18 }}>
          {description}
        </T>
      ) : null}
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
