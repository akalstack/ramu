import { screen, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { z } from 'zod'

const savedSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(100).max(20_000),
  height: z.number().int().min(100).max(20_000),
  maximized: z.boolean().optional(),
})
type SavedBounds = z.infer<typeof savedSchema>

/** Where a window was last on this device, or null when nothing is saved or that display is gone. */
export function savedBounds(file: string): SavedBounds | null {
  try {
    if (!existsSync(file)) return null
    const bounds = savedSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    // A display that is gone would leave the window off screen.
    const visible = screen
      .getAllDisplays()
      .some(
        ({ workArea: area }) =>
          bounds.x >= area.x - 40 &&
          bounds.y >= area.y - 40 &&
          bounds.x < area.x + area.width &&
          bounds.y < area.y + area.height,
      )
    return visible ? bounds : null
  } catch {
    return null
  }
}

/** Saves the window's size and place whenever the person moves or resizes it, and whether it is maximized. */
export function rememberBounds(window: BrowserWindow, file: string) {
  const save = () => {
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return
    try {
      // Maximized keeps the size it had before, so un-maximizing after a restart returns to it.
      writeFileSync(file, JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() }))
    } catch {
      /* The next window opens at its default size. */
    }
  }
  window.on('moved', save)
  window.on('resized', save)
  window.on('maximize', save)
  window.on('unmaximize', save)
  window.on('close', save)
}
