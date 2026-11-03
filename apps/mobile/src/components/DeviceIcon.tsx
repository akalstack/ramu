import { useMemo } from 'react'
import { View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { Laptop, Server, Smartphone, Tablet } from 'lucide-react-native'
import type { DeviceOs } from '@ramu/shared/types'
import { guessForm, osMark } from '@ramu/shared/deviceOs'
import { svgs } from '../assets/svgs'
import { useTheme } from '../theme'

const SHAPES = { phone: Smartphone, tablet: Tablet, computer: Laptop, server: Server }

/**
 * A device or host as the desktop draws it: its shape with its OS's mark in the corner (an iPhone, an Android tablet, a
 * Mac, an Ubuntu server). A device that has not said what it runs on shows its shape alone, guessed from its name.
 */
export function DeviceIcon({ os, name = '', size = 17 }: { os?: DeviceOs; name?: string; size?: number }) {
  const { c } = useTheme()
  const Shape = SHAPES[os?.form ?? guessForm(name)]
  const mark = osMark(os)
  const badge = Math.round(size * 0.68)
  // The marks set their color through a missing fill; it is written in so they follow the theme.
  const xml = useMemo(
    () => (mark ? svgs[`os:${mark}`].replace(/<path\b/g, `<path fill="${c.text}"`) : null),
    [mark, c.text],
  )
  return (
    <View>
      <Shape size={size} color={c.soft} strokeWidth={1.8} />
      {xml ? (
        <View
          style={{
            position: 'absolute',
            right: -6,
            bottom: -6,
            padding: 1.5,
            borderRadius: 99,
            backgroundColor: c.raised,
          }}
        >
          <SvgXml xml={xml} width={badge} height={badge} />
        </View>
      ) : null}
    </View>
  )
}
