import { describe, expect, it } from 'vitest'
import { appVariables } from '../src/envSync'

describe('appVariables', () => {
  it('reads names from example files and from code in each language, without the runtime’s own', () => {
    const names = appVariables([
      { path: '.env.example', text: 'DATABASE_URL=postgres://\n# comment\nexport STRIPE_SECRET_KEY=\nlowercase=1\n' },
      { path: 'web/.env.sample', text: 'NEXT_PUBLIC_SITE=https://x\n' },
      {
        path: 'src/app.ts',
        text: "const a = process.env.RESEND_API_KEY; const b = process.env['SESSION_SECRET']; if (process.env.NODE_ENV) {}",
      },
      { path: 'src/main.tsx', text: 'fetch(import.meta.env.VITE_API_URL + import.meta.env.MODE)' },
      { path: 'app.py', text: "os.environ['SECRET_KEY']; os.environ.get(\"OPENAI_API_KEY\"); os.getenv('PORT')" },
      { path: 'config.rb', text: 'ENV[\'MAILGUN_KEY\']; ENV.fetch("REDIS_URL")' },
      { path: 'main.go', text: 'os.Getenv("SENTRY_DSN"); os.LookupEnv("FLY_REGION")' },
    ])
    expect(names).toEqual([
      'DATABASE_URL',
      'FLY_REGION',
      'MAILGUN_KEY',
      'NEXT_PUBLIC_SITE',
      'OPENAI_API_KEY',
      'REDIS_URL',
      'RESEND_API_KEY',
      'SECRET_KEY',
      'SENTRY_DSN',
      'SESSION_SECRET',
      'STRIPE_SECRET_KEY',
      'VITE_API_URL',
    ])
  })

  it('ignores names that only look like variables and lists each once', () => {
    expect(
      appVariables([
        { path: 'a.ts', text: 'process.env.API_KEY; process.env.API_KEY; process.envX.NOPE; env.OTHER' },
        { path: 'README.md', text: 'process.env.DOCS_ONLY' },
      ]),
    ).toEqual(['API_KEY', 'DOCS_ONLY'])
  })
})
