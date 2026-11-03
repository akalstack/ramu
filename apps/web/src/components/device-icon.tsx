import type { CSSProperties } from 'react'
import { Laptop, Server, Smartphone, Tablet } from 'lucide-react'
import type { DeviceOs } from '@ramu/shared/types'
import { guessForm, osMark, type OsMark } from '@ramu/shared/deviceOs'
import apple from '../assets/os/apple.svg'
import android from '../assets/os/android.svg'
import ubuntu from '../assets/os/ubuntu.svg'
import debian from '../assets/os/debian.svg'
import fedora from '../assets/os/fedora.svg'
import arch from '../assets/os/arch.svg'
import mint from '../assets/os/mint.svg'
import redhat from '../assets/os/redhat.svg'
import raspberrypi from '../assets/os/raspberrypi.svg'
import linux from '../assets/os/linux.svg'
import windows from '../assets/os/windows.svg'

const MARKS: Record<OsMark, string> = {
  apple,
  android,
  ubuntu,
  debian,
  fedora,
  arch,
  mint,
  redhat,
  raspberrypi,
  linux,
  windows,
}
const SHAPES = { phone: Smartphone, tablet: Tablet, computer: Laptop, server: Server }

/**
 * A device or host as a tile: its shape (phone, tablet, computer, server) with its OS's mark in the corner, so an iPhone,
 * an Android phone, an iPad, an Android tablet, a Mac and an Ubuntu server each read at a glance. A device that has not
 * said what it runs on shows its shape alone, guessed from its name.
 */
export function DeviceIcon({ os, name = '', size = 16 }: { os?: DeviceOs; name?: string; size?: number }) {
  const Shape = SHAPES[os?.form ?? guessForm(name)]
  const mark = osMark(os)
  const badge = Math.round(size * 0.7)
  const style: CSSProperties | undefined = mark
    ? {
        width: badge,
        height: badge,
        backgroundColor: 'currentColor',
        maskImage: `url("${MARKS[mark]}")`,
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
      }
    : undefined
  return (
    <span className="relative inline-flex flex-none" aria-hidden="true">
      <Shape size={size} />
      {style && (
        <span className="absolute -right-1.5 -bottom-1.5 flex items-center justify-center rounded-full bg-raised p-[1.5px] text-foreground">
          <span className="block" style={style} />
        </span>
      )}
    </span>
  )
}
