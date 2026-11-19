import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { portableSettings } from '@ramu/shared/settingsCompatibility'
import { SETTINGS_CATALOG } from '@ramu/shared/settingsCatalog'
import { APP_AUTO_UPDATE } from '@ramu/shared/updates'
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

it('gives every settings row search and agents can find a catalog entry, and every catalog path a real setting', () => {
  const schema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const known = new Set(
    portableSettings(schema, DEFAULT_APP_PREFERENCES as unknown as Record<string, unknown>).map((field) => field.path),
  )
  const catalogued = new Set(SETTINGS_CATALOG.flatMap((entry) => (entry.path ? [entry.path] : [])))
  expect([...catalogued].filter((path) => !path.startsWith('$') && !known.has(path))).toEqual([])
  const rows = new Set(
    files(web).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/setting="([^"$]+)"/g)].map((match) => match[1]!),
    ),
  )
  // Builds without automatic updates leave that row out of Settings and search alike.
  expect([...rows].filter((path) => !catalogued.has(path) && (APP_AUTO_UPDATE || path !== 'appAutoUpdate'))).toEqual([])
})

it('advertises the default of every catalogued setting, so a changed row shows its dot and Reset', () => {
  const schema = z.toJSONSchema(appPreferences, { unrepresentable: 'any' }) as SettingSchema
  const fields = portableSettings(schema, DEFAULT_APP_PREFERENCES as unknown as Record<string, unknown>)
  // An ordered list has no single default to put back.
  const listed = new Set(['fallback.order'])
  const missing = SETTINGS_CATALOG.flatMap((entry) => (entry.path ? [entry.path] : [])).filter(
    (path) =>
      !path.startsWith('$') &&
      !listed.has(path) &&
      fields.find((field) => field.path === path)?.schema.default === undefined,
  )
  expect(missing).toEqual([])
  // The advertised default is the one the app itself starts from.
  for (const field of fields)
    if (field.schema.default !== undefined)
      expect([field.path, field.value]).toEqual([field.path, field.schema.default])
})
