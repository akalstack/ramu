// What this host runs on, for the icon and line other devices show for it, and the check for what a paired device says
// it runs on. Read from files the OS keeps for this purpose; nothing is executed.
import { readFileSync } from 'node:fs'
import { release } from 'node:os'
import { z } from 'zod'
import type { DeviceOs } from '@ramu/shared/types'

const text = (max: number) => z.string().trim().min(1).max(max)

export const deviceOsSchema = z.object({
  os: z.enum(['ios', 'ipados', 'android', 'macos', 'linux', 'windows', 'unknown']),
  form: z.enum(['phone', 'tablet', 'computer', 'server']),
  version: text(40).optional(),
  distro: z
    .string()
    .trim()
    .regex(/^[a-z0-9._-]{1,32}$/)
    .optional(),
  distroName: text(60).optional(),
  model: text(60).optional(),
}) satisfies z.ZodType<DeviceOs>

/** `KEY=value` pairs from os-release, quotes removed. */
export function osRelease(contents: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of contents.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]!] = match[2]!.replace(/^["']|["']$/g, '')
  }
  return values
}

const read = (path: string) => {
  try {
    return readFileSync(path, 'utf8').slice(0, 64 * 1024)
  } catch {
    return ''
  }
}

export function readHostOs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  file: (path: string) => string = read,
): DeviceOs {
  if (platform === 'darwin') {
    const version = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
      file('/System/Library/CoreServices/SystemVersion.plist'),
    )?.[1]
    return { os: 'macos', form: 'computer', ...(version ? { version } : {}) }
  }
  if (platform === 'linux') {
    const values = osRelease(file('/etc/os-release') || file('/usr/lib/os-release'))
    const parsed = deviceOsSchema.safeParse({
      os: 'linux',
      // No display means nobody sits at it: a server, a VM or a container.
      form: env.DISPLAY || env.WAYLAND_DISPLAY ? 'computer' : 'server',
      ...(values.VERSION_ID ? { version: values.VERSION_ID } : {}),
      ...(values.ID ? { distro: values.ID.toLowerCase() } : {}),
      ...(values.PRETTY_NAME || values.NAME ? { distroName: values.PRETTY_NAME || values.NAME } : {}),
    })
    return parsed.success ? parsed.data : { os: 'linux', form: 'server' }
  }
  if (platform === 'win32') return { os: 'windows', form: 'computer', version: release() }
  return { os: 'unknown', form: 'computer' }
}
