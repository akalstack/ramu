// Which stack a new project starts on, from a few answers about it: the framework's own generator, the commands to
// develop, build and test it, and where it deploys by default. Pure, so the agent tool, the deploy sheet and both
// clients recommend the same thing. Commands are argument lists, never shell strings.

export const STACK_IDS = [
  'static',
  'nextjs',
  'vite-react',
  'astro',
  'expo',
  'node-api',
  'django',
  'fastapi',
  'rails',
  'go',
] as const
export type StackId = (typeof STACK_IDS)[number]

/** A new project's folder name: letters, digits, dots, dashes and underscores, starting with a letter or digit. */
export const PROJECT_NAME = /^[A-Za-z0-9][\w.-]{0,99}$/

/**
 * Platforms a stack deploys to by default, each with its own name. Agents deploy through the platform's plugin (its MCP
 * tools or its CLI), so Ramu has no code of its own for any of them.
 */
export const DEPLOY_TARGETS = {
  vercel: 'Vercel',
  netlify: 'Netlify',
  railway: 'Railway',
  fly: 'Fly.io',
  cloudflare: 'Cloudflare',
} as const
export type DeployTargetId = keyof typeof DEPLOY_TARGETS
export const isDeployTarget = (value: unknown): value is DeployTargetId =>
  typeof value === 'string' && Object.hasOwn(DEPLOY_TARGETS, value)

export interface Stack {
  id: StackId
  name: string
  /** One line for the person, such as "Next.js with a Postgres database, deployed on Vercel". */
  summary: string
  /** The official generator, run in the new, empty project folder (`.` is that folder); empty when files are written by hand. */
  generator: string[][]
  dev: string[] | null
  build: string[] | null
  test: string[] | null
  /** Text the dev server prints once it serves, so the browser can open on it. */
  readyText: string | null
  /** Null for a phone app, which ships through the app stores rather than a hosting platform. */
  deployTarget: DeployTargetId | null
  /** Stores data in a Postgres database. */
  database: boolean
  /** Applies database migrations, run before each production deploy through a plugin. */
  migrate: string[] | null
  /** Lines added to `.gitignore` when the generator does not write one. */
  ignore: string[]
}

export interface StackAnswers {
  /** A website, a phone app, or a service other programs call. */
  kind: 'web' | 'phone' | 'api'
  signIn: boolean
  /** Stores data of its own (bookings, accounts, posts). */
  data: boolean
  /** Mostly pages to read (a blog, docs, a portfolio) rather than an app to use. */
  content?: boolean
  /** A language or framework the person asked for by name. */
  language?: 'javascript' | 'python' | 'ruby' | 'go'
}

const NODE_IGNORE = ['node_modules/', '.env', '.env.*', '!.env.example', 'dist/', '.DS_Store']

export const STACKS: Record<StackId, Stack> = {
  static: {
    id: 'static',
    name: 'Static site',
    summary: 'A static HTML site, deployed on Netlify',
    generator: [],
    dev: ['npx', '--yes', 'serve', '.'],
    build: null,
    test: null,
    readyText: 'Accepting connections',
    deployTarget: 'netlify',
    database: false,
    migrate: null,
    ignore: ['.DS_Store'],
  },
  nextjs: {
    id: 'nextjs',
    name: 'Next.js',
    summary: 'Next.js with TypeScript, deployed on Vercel',
    generator: [
      [
        'npx',
        '--yes',
        'create-next-app@latest',
        '.',
        '--yes',
        '--ts',
        '--eslint',
        '--app',
        '--tailwind',
        '--use-npm',
        '--disable-git',
      ],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npm', 'run', 'lint'],
    readyText: 'Ready in',
    deployTarget: 'vercel',
    database: true,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  'vite-react': {
    id: 'vite-react',
    name: 'Vite + React',
    summary: 'React with Vite and TypeScript, deployed on Netlify',
    generator: [
      ['npm', 'create', '--yes', 'vite@latest', '.', '--', '--template', 'react-ts', '--no-interactive'],
      ['npm', 'install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npm', 'run', 'lint'],
    readyText: 'Local:',
    deployTarget: 'netlify',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  astro: {
    id: 'astro',
    name: 'Astro',
    summary: 'An Astro site, deployed on Netlify',
    generator: [
      ['npm', 'create', '--yes', 'astro@latest', '.', '--', '--template', 'minimal', '--install', '--no-git', '--yes'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npx', '--yes', 'astro', 'check'],
    readyText: 'Local',
    deployTarget: 'netlify',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  expo: {
    id: 'expo',
    name: 'Expo',
    summary: 'An Expo app for iPhone and Android',
    generator: [
      ['npx', '--yes', 'create-expo-app@latest', '.', '--yes', '--no-install'],
      ['npm', 'install'],
    ],
    dev: ['npx', 'expo', 'start'],
    build: ['npx', 'expo', 'export'],
    test: ['npx', 'tsc', '--noEmit'],
    readyText: 'Metro waiting on',
    deployTarget: null,
    database: false,
    migrate: null,
    ignore: [...NODE_IGNORE, '.expo/'],
  },
  'node-api': {
    id: 'node-api',
    name: 'Node API',
    summary: 'A Node.js API with Hono, deployed on Railway',
    generator: [
      ['npm', 'create', '--yes', 'hono@latest', '.', '--', '--template', 'nodejs', '--pm', 'npm', '--install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npx', 'tsc', '--noEmit'],
    readyText: 'Server is running',
    deployTarget: 'railway',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  django: {
    id: 'django',
    name: 'Django',
    summary: 'Django with a Postgres database, deployed on Railway',
    generator: [
      ['uv', 'init', '--app', '--no-workspace', '--vcs', 'none'],
      ['uv', 'add', 'django'],
      ['uv', 'run', 'django-admin', 'startproject', 'config', '.'],
    ],
    dev: ['uv', 'run', 'manage.py', 'runserver'],
    build: ['uv', 'run', 'manage.py', 'check', '--deploy'],
    test: ['uv', 'run', 'manage.py', 'test'],
    readyText: 'Quit the server with',
    deployTarget: 'railway',
    database: true,
    migrate: ['uv', 'run', 'manage.py', 'migrate'],
    ignore: ['.venv/', '__pycache__/', '*.pyc', '.env', 'db.sqlite3', '.DS_Store'],
  },
  fastapi: {
    id: 'fastapi',
    name: 'FastAPI',
    summary: 'A FastAPI service, deployed on Railway',
    generator: [
      ['uv', 'init', '--app', '--no-workspace', '--vcs', 'none'],
      ['uv', 'add', 'fastapi[standard]'],
      ['uv', 'add', '--dev', 'pytest'],
    ],
    dev: ['uv', 'run', 'fastapi', 'dev', 'main.py'],
    build: null,
    test: ['uv', 'run', 'pytest'],
    readyText: 'Application startup complete',
    deployTarget: 'railway',
    database: false,
    migrate: null,
    ignore: ['.venv/', '__pycache__/', '*.pyc', '.env', '.DS_Store'],
  },
  rails: {
    id: 'rails',
    name: 'Rails',
    summary: 'Rails with a Postgres database, deployed on Fly',
    generator: [['rails', 'new', '.', '--database=postgresql', '--skip-git']],
    dev: ['bin/rails', 'server'],
    build: ['bin/rails', 'assets:precompile'],
    test: ['bin/rails', 'test'],
    readyText: 'Listening on',
    deployTarget: 'fly',
    database: true,
    migrate: ['bin/rails', 'db:migrate'],
    ignore: [],
  },
  go: {
    id: 'go',
    name: 'Go',
    summary: 'A Go web service, deployed on Fly',
    generator: [],
    dev: ['go', 'run', '.'],
    build: ['go', 'build', './...'],
    test: ['go', 'test', './...'],
    readyText: null,
    deployTarget: 'fly',
    database: false,
    migrate: null,
    ignore: ['/bin/', '.env', '.DS_Store'],
  },
}

/** The smallest stack that does the job: static pages first, a full framework only when the app needs one. */
export function chooseStack(answers: StackAnswers): StackId {
  if (answers.kind === 'phone') return 'expo'
  if (answers.language === 'python') return answers.kind === 'api' ? 'fastapi' : 'django'
  if (answers.language === 'ruby') return 'rails'
  if (answers.language === 'go') return 'go'
  if (answers.kind === 'api') return 'node-api'
  if (answers.signIn || answers.data) return 'nextjs'
  return answers.content ? 'astro' : 'static'
}

/** A command list as one line, for a card or a goal's verification command. Arguments with spaces are quoted. */
export function commandLine(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./[\]-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ')
}

/** The goal check for a new project: its build, then its tests, where it has them. */
export function stackCheck(stack: Stack): string | null {
  const steps = [stack.build, stack.test].filter((step): step is string[] => !!step).map(commandLine)
  return steps.length ? steps.join(' && ') : null
}
