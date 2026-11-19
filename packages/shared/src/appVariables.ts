// Which environment variables an app reads, so an app run on this computer gets only those of the saved values. Pure,
// so the scan is tested without a repository; values never appear here, only names.
import { parseDotEnv } from './providers/environment'

/** Example files whose names list the variables an app expects. */
export const ENV_EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.local.example']

/** Source files read for variable names. */
export const ENV_CODE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|rb|go)$/

/** At most this many variables are listed. */
export const MAX_APP_VARIABLES = 200

const NAME = '([A-Z][A-Z0-9_]{1,127})'
const PATTERNS = [
  // JavaScript: process.env.NAME, process.env['NAME'], import.meta.env.NAME, Deno.env.get('NAME')
  new RegExp(`process\\.env\\.${NAME}\\b`, 'g'),
  new RegExp(`process\\.env\\[\\s*['"\`]${NAME}['"\`]\\s*\\]`, 'g'),
  new RegExp(`import\\.meta\\.env\\.${NAME}\\b`, 'g'),
  new RegExp(`Deno\\.env\\.get\\(\\s*['"]${NAME}['"]`, 'g'),
  // Python: os.environ['NAME'], os.environ.get('NAME'), os.getenv('NAME')
  new RegExp(`os\\.environ\\[\\s*['"]${NAME}['"]\\s*\\]`, 'g'),
  new RegExp(`os\\.(?:environ\\.get|getenv)\\(\\s*['"]${NAME}['"]`, 'g'),
  // Ruby: ENV['NAME'], ENV.fetch('NAME')
  new RegExp(`ENV(?:\\[\\s*|\\.fetch\\(\\s*)['"]${NAME}['"]`, 'g'),
  // Go: os.Getenv("NAME"), os.LookupEnv("NAME")
  new RegExp(`os\\.(?:Getenv|LookupEnv)\\(\\s*"${NAME}"`, 'g'),
]

/** Variables the runtime or the platform sets itself. */
const PROVIDED = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'HOSTNAME',
  'CI',
  'HOME',
  'PATH',
  'PWD',
  'TZ',
  'DEV',
  'PROD',
  'MODE',
  'SSR',
  'BASE_URL',
  'VERCEL',
  'VERCEL_ENV',
  'VERCEL_URL',
  'NETLIFY',
  'CONTEXT',
  'DEPLOY_URL',
  'URL',
  'GITHUB_ACTIONS',
  'NEXT_RUNTIME',
])

/** The variables an app reads: names from its example env files and from code that reads the environment. */
export function appVariables(files: readonly { path: string; text: string }[]): string[] {
  const found = new Set<string>()
  for (const { path, text } of files) {
    const base = path.split('/').pop() ?? path
    if (ENV_EXAMPLE_FILES.includes(base)) {
      for (const { key } of parseDotEnv(text)) if (/^[A-Z][A-Z0-9_]{1,127}$/.test(key)) found.add(key)
      continue
    }
    for (const pattern of PATTERNS) for (const match of text.matchAll(pattern)) found.add(match[1]!)
  }
  return [...found]
    .filter((name) => !PROVIDED.has(name))
    .sort()
    .slice(0, MAX_APP_VARIABLES)
}
