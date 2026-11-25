import { useCallback, useEffect, useState } from 'react'
import type { ArtifactInfo, InstalledArtifactApp } from '@ramu/shared/artifacts'
import { invokerFor, ramu } from '../ipc'

const ICON_SIZE = 512
// The rounded tile macOS gives its own app icons, inside the margin its icon grid keeps.
const TILE_INSET = 50
const TILE_RADIUS = 92

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That picture could not be read.'))
    image.src = src
  })

/**
 * The app icon at 512 px as a PNG data URL: the chosen picture filling a rounded tile, or the artifact's emoji drawn on
 * one. The system's emoji font draws the emoji, so it matches how it looks everywhere else on this computer.
 */
export async function drawAppIcon(emoji: string, picture: string | null): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the icon.')
  const side = ICON_SIZE - TILE_INSET * 2
  context.beginPath()
  context.roundRect(TILE_INSET, TILE_INSET, side, side, TILE_RADIUS)
  if (picture) {
    const image = await loadImage(picture)
    context.clip()
    // Covers the tile, cropping the longer side around its center.
    const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight)
    const width = image.naturalWidth * scale
    const height = image.naturalHeight * scale
    context.drawImage(image, TILE_INSET + (side - width) / 2, TILE_INSET + (side - height) / 2, width, height)
  } else {
    context.fillStyle = '#f4f4f5'
    context.fill()
    context.font = '250px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(emoji, ICON_SIZE / 2, ICON_SIZE / 2 + 12)
  }
  return canvas.toDataURL('image/png')
}

/**
 * A picture the person chose, as a square PNG data URL of at most 512 px cropped around its center, so the host keeps
 * a small file whatever size the original was.
 */
export async function squarePicture(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const crop = Math.min(image.naturalWidth, image.naturalHeight)
    const size = Math.min(ICON_SIZE, crop)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('That picture could not be read.')
    context.drawImage(
      image,
      (image.naturalWidth - crop) / 2,
      (image.naturalHeight - crop) / 2,
      crop,
      crop,
      0,
      0,
      size,
      size,
    )
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Whether this artifact is installed as an app on this desktop, and the actions to install or remove it. An installed
 * app whose title, emoji or picture changed since is redrawn, so its launcher keeps matching the artifact.
 */
export function useArtifactApp(host: string, page: ArtifactInfo | null) {
  const [apps, setApps] = useState<InstalledArtifactApp[] | null>(null)
  useEffect(() => {
    let current = true
    const read = () =>
      void ramu
        .invoke('artifactApps.list')
        .then((list) => current && setApps(list))
        .catch(() => current && setApps([]))
    read()
    const off = ramu.on('artifact-apps:changed', read)
    return () => {
      current = false
      off()
    }
  }, [])
  const installed = page ? (apps?.find((app) => app.hostId === host && app.artifactId === page.id) ?? null) : null
  const install = useCallback(async () => {
    if (!page) return
    const picture = page.appIcon ? await invokerFor(host)('artifacts.appIcon', page.id) : null
    await ramu.invoke(
      'artifactApps.install',
      {
        hostId: host,
        artifactId: page.id,
        title: page.title,
        icon: page.icon,
        ...(page.appIcon && picture ? { appIcon: page.appIcon } : {}),
      },
      await drawAppIcon(page.icon, picture),
    )
  }, [host, page])
  const stale =
    !!installed &&
    !!page &&
    (installed.title !== page.title || installed.icon !== page.icon || installed.appIcon !== page.appIcon)
  useEffect(() => {
    if (stale) void install().catch(() => {})
  }, [stale, install])
  return {
    /** Null until the list is read. */
    installed: apps === null ? null : !!installed,
    install,
    remove: () => (page ? ramu.invoke('artifactApps.remove', host, page.id) : Promise.resolve()),
    openWindow: () => (page ? ramu.invoke('artifactApps.open', host, page.id) : Promise.resolve()),
  }
}
