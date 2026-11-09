import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { portableSettings } from '@ramu/shared/settingsCompatibility'
import type { SettingSchema } from '@ramu/shared/settingsCompatibility'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { appPreferences } from '../src/ipc/preferences'

const web = fileURLToPath(new URL('../../web/src', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [],
  )

it('names on every settings row a setting the host lists, or the row says the setting is missing on this host', () => {
  const schema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const known = new Set(
    portableSettings(schema, DEFAULT_APP_PREFERENCES as unknown as Record<string, unknown>).map((field) => field.path),
  )
  const unknown = files(web).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/setting="([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((path) => !path.startsWith('$') && !known.has(path))
      .map((path) => `${file.slice(web.length + 1)}: ${path}`),
  )
  expect(unknown).toEqual([])
})
