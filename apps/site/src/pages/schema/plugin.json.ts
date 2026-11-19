// The plugin manifest's JSON Schema, written at build time from the zod schema Ramu validates with, so an editor
// checks a manifest exactly as `ramu plugin check` does.
import { pluginJsonSchema } from '../../../../../packages/shared/src/plugins'

export function GET() {
  return new Response(`${JSON.stringify(pluginJsonSchema(), null, 2)}\n`, {
    headers: { 'Content-Type': 'application/schema+json' },
  })
}
