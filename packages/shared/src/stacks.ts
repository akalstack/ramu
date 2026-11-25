// Which stack a new project starts on, from a few answers about it: the framework's own generator and the commands to
// develop, build and test it. Pure, so the agent tool and both clients recommend the same thing. Commands are argument
// lists, never shell strings.

export const STACK_IDS = [
  'static',
  'vite-vanilla',
  'node',
  'nextjs',
  'vite-react',
  'vite-vue',
  'nuxt',
  'astro',
  'expo',
  'node-api',
  'django',
  'fastapi',
  'rails',
  'go',
  'rust',
  'swift',
  'tauri',
  'electron',
  'flutter',
] as const
export type StackId = (typeof STACK_IDS)[number]

/** A new project's folder name: letters, digits, dots, dashes and underscores, starting with a letter or digit. */
export const PROJECT_NAME = /^[A-Za-z0-9][\w.-]{0,99}$/

export interface Stack {
  id: StackId
  name: string
  /** One line for the person, such as "Next.js with TypeScript". */
  summary: string
  /**
   * Built on a framework rather than the language and platform alone. With agents writing code quickly, a framework is
   * worth it for sign-in, stored data, many routed pages, or a phone or desktop app, and otherwise only adds weight.
   */
  framework: boolean
  /** The official generator, run in the new, empty project folder (`.` is that folder); empty when files are written by hand. */
  generator: string[][]
  dev: string[] | null
  build: string[] | null
  test: string[] | null
  /** Text the dev server prints once it serves, so the browser can open on it. */
  readyText: string | null
  /** Stores data in a Postgres database. */
  database: boolean
  /** Applies database migrations, run before each production deploy through a plugin. */
  migrate: string[] | null
  /** Lines added to `.gitignore` when the generator does not write one. */
  ignore: string[]
  /** What the host needs installed beyond Node, which the agent checks before running the project. */
  prerequisites?: string
  /** A desktop or phone app, which ships through app stores or installers rather than a hosting platform. */
  installed?: boolean
}

/**
 * What a new project is generated with: one of the stacks above, or one an agent looked up for a framework they do not
 * cover (such as Tauri), which has no id and keeps the sources its commands came from.
 */
export interface StackPlan extends Omit<Stack, 'id'> {
  id: StackId | null
  /** Where the agent found the generator; shown to the person before it runs. */
  sources?: string[]
}

/** A stack an agent looked up on the web: the framework's own generator and commands, never a shell line. */
export interface CustomStack {
  name: string
  summary: string
  generator: string[][]
  dev?: string[]
  build?: string[]
  test?: string[]
  readyText?: string
  ignore?: string[]
  /** Built on a framework; false for the language and platform alone. Defaults to true. */
  framework?: boolean
  sources: string[]
}

/** Programs a generator step may not start: shells and interpreters running inline code, downloads and privilege. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'pwsh', 'powershell', 'cmd'])
const NEVER = new Set([
  'sudo',
  'doas',
  'su',
  'env',
  'eval',
  'exec',
  'xargs',
  'find',
  'curl',
  'wget',
  'nohup',
  'rm',
  'chmod',
  'osascript',
])
const INTERPRETER = /^(?:node|python[\d.]*|ruby|perl|php|deno|bun|npx|npm|pnpm|yarn|uv|uvx)$/
/** Flags that make an interpreter or package runner run a line of code or shell given right there. */
const INLINE = new Set(['-c', '-e', '-E', '--eval', '-p', '--print', '--call', 'eval'])

/**
 * Why one step of a looked-up stack cannot run, or null when it can. Steps run without a shell in the new folder, and
 * the person approves every one first; this refuses the obvious ways to run more than the line shows (a shell, inline
 * code, a download, more privilege, paths outside the folder), so what they approve is what runs.
 */
export function unsafeStep(argv: readonly string[]): string | null {
  const program = (argv[0] ?? '')
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (!program) return 'A step needs a program.'
  // A script of the project's own (`bin/rails`) is fine; a program from elsewhere on the computer is not.
  if (/^(?:[\\/]|~|[A-Za-z]:)/.test(argv[0] ?? '') || (argv[0] ?? '').split(/[\\/]/).includes('..'))
    return `Run ${program} by name, not from another folder.`
  if (SHELLS.has(program) || NEVER.has(program)) return `${program} cannot start a project.`
  if (INTERPRETER.test(program) && argv.slice(1).some((arg) => INLINE.has(arg) || /^--(?:call|eval)=/.test(arg)))
    return `${program} cannot run inline code here.`
  // Runners that start another program (`uv run python -c`, `npx node -e`) are held to the same rule for it.
  if (argv.slice(1).some((arg, index) => INTERPRETER.test(arg) && INLINE.has(argv[index + 2] ?? '')))
    return `${program} cannot run inline code here.`
  if (argv.slice(1).some((arg) => /^(?:\/|~)/.test(arg) || arg.split(/[\\/]/).includes('..')))
    return 'Arguments stay inside the new project folder.'
  if (argv.some((arg) => /[\n\r\0]/.test(arg))) return 'Arguments cannot span lines.'
  return null
}

/** A looked-up stack as a plan, or an error naming the first step that cannot run. */
export function customStackPlan(custom: CustomStack): StackPlan {
  for (const step of [...custom.generator, custom.dev, custom.build, custom.test]) {
    const problem = step ? unsafeStep(step) : null
    if (problem) throw new Error(problem)
  }
  return {
    id: null,
    framework: custom.framework ?? true,
    name: custom.name,
    summary: custom.summary,
    generator: custom.generator,
    dev: custom.dev ?? null,
    build: custom.build ?? null,
    test: custom.test ?? null,
    readyText: custom.readyText ?? null,
    database: false,
    migrate: null,
    ignore: custom.ignore ?? ['.env', '.DS_Store'],
    sources: custom.sources,
  }
}

export interface StackAnswers {
  /** A website, a phone app, a desktop app, or a service other programs call. */
  kind: 'web' | 'phone' | 'desktop' | 'api'
  signIn: boolean
  /** Stores data of its own (bookings, accounts, posts). */
  data: boolean
  /** Mostly pages to read (a blog, docs, a portfolio) rather than an app to use. */
  content?: boolean
  /** Something to use in the browser (a tool, a game, a calculator) rather than pages to read. */
  app?: boolean
  /** The UI library the person prefers, when they said. */
  ui?: 'react' | 'vue'
  /** A language or framework the person asked for by name. */
  language?: 'javascript' | 'python' | 'ruby' | 'go' | 'rust' | 'swift' | 'dart'
}

const NODE_IGNORE = ['node_modules/', '.env', '.env.*', '!.env.example', 'dist/', '.DS_Store']

const RUST = 'Rust, installed with rustup (https://rustup.rs)'

export const STACKS: Record<StackId, Stack> = {
  static: {
    id: 'static',
    framework: false,
    name: 'Static site',
    summary: 'A static HTML site',
    generator: [],
    dev: ['npx', '--yes', 'serve', '.'],
    build: null,
    test: null,
    readyText: 'Accepting connections',
    database: false,
    migrate: null,
    ignore: ['.DS_Store'],
  },
  'vite-vanilla': {
    id: 'vite-vanilla',
    framework: false,
    name: 'Vite (no framework)',
    summary: 'A web app in plain TypeScript, built with Vite',
    generator: [
      ['npm', 'create', '--yes', 'vite@latest', '.', '--', '--template', 'vanilla-ts', '--no-interactive'],
      ['npm', 'install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: null,
    readyText: 'Local:',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  node: {
    id: 'node',
    framework: false,
    name: 'Node (no framework)',
    summary: 'A Node.js service on its built-in HTTP server and test runner',
    generator: [
      ['npm', 'init', '-y'],
      [
        'npm',
        'pkg',
        'set',
        'type=module',
        'scripts.dev=node --watch server.js',
        'scripts.start=node server.js',
        'scripts.test=node --test',
      ],
    ],
    dev: ['npm', 'run', 'dev'],
    build: null,
    test: ['npm', 'test'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  nextjs: {
    id: 'nextjs',
    framework: true,
    name: 'Next.js',
    summary: 'Next.js with TypeScript',
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
    database: true,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  'vite-react': {
    id: 'vite-react',
    framework: true,
    name: 'Vite + React',
    summary: 'React with Vite and TypeScript',
    generator: [
      ['npm', 'create', '--yes', 'vite@latest', '.', '--', '--template', 'react-ts', '--no-interactive'],
      ['npm', 'install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npm', 'run', 'lint'],
    readyText: 'Local:',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  'vite-vue': {
    id: 'vite-vue',
    framework: true,
    name: 'Vite + Vue',
    summary: 'Vue with Vite and TypeScript',
    generator: [
      ['npm', 'create', '--yes', 'vite@latest', '.', '--', '--template', 'vue-ts', '--no-interactive'],
      ['npm', 'install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: null,
    readyText: 'Local:',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  nuxt: {
    id: 'nuxt',
    framework: true,
    name: 'Nuxt',
    summary: 'A Nuxt app with Vue, pages and server routes',
    generator: [
      [
        'npm',
        'create',
        '--yes',
        'nuxt@latest',
        '.',
        '--',
        '--template',
        'minimal',
        '--packageManager',
        'npm',
        '--no-gitInit',
        '--force',
      ],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: null,
    readyText: 'Local:',
    database: false,
    migrate: null,
    ignore: [...NODE_IGNORE, '.nuxt/', '.output/'],
  },
  astro: {
    id: 'astro',
    framework: true,
    name: 'Astro',
    summary: 'An Astro site',
    generator: [
      ['npm', 'create', '--yes', 'astro@latest', '.', '--', '--template', 'minimal', '--install', '--no-git', '--yes'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npx', '--yes', 'astro', 'check'],
    readyText: 'Local',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  expo: {
    id: 'expo',
    installed: true,
    framework: true,
    name: 'React Native (Expo)',
    summary: 'An Expo app for iPhone and Android',
    generator: [
      ['npx', '--yes', 'create-expo-app@latest', '.', '--yes', '--no-install'],
      ['npm', 'install'],
    ],
    dev: ['npx', 'expo', 'start'],
    build: ['npx', 'expo', 'export'],
    test: ['npx', 'tsc', '--noEmit'],
    readyText: 'Metro waiting on',
    database: false,
    migrate: null,
    ignore: [...NODE_IGNORE, '.expo/'],
  },
  'node-api': {
    id: 'node-api',
    framework: true,
    name: 'Node API',
    summary: 'A Node.js API with Hono',
    generator: [
      ['npm', 'create', '--yes', 'hono@latest', '.', '--', '--template', 'nodejs', '--pm', 'npm', '--install'],
    ],
    dev: ['npm', 'run', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['npx', 'tsc', '--noEmit'],
    readyText: 'Server is running',
    database: false,
    migrate: null,
    ignore: NODE_IGNORE,
  },
  django: {
    id: 'django',
    framework: true,
    name: 'Django',
    summary: 'Django with a Postgres database',
    generator: [
      ['uv', 'init', '--app', '--no-workspace', '--vcs', 'none'],
      ['uv', 'add', 'django'],
      ['uv', 'run', 'django-admin', 'startproject', 'config', '.'],
    ],
    dev: ['uv', 'run', 'manage.py', 'runserver'],
    build: ['uv', 'run', 'manage.py', 'check', '--deploy'],
    test: ['uv', 'run', 'manage.py', 'test'],
    readyText: 'Quit the server with',
    database: true,
    migrate: ['uv', 'run', 'manage.py', 'migrate'],
    ignore: ['.venv/', '__pycache__/', '*.pyc', '.env', 'db.sqlite3', '.DS_Store'],
  },
  fastapi: {
    id: 'fastapi',
    framework: true,
    name: 'FastAPI',
    summary: 'A FastAPI service',
    generator: [
      ['uv', 'init', '--app', '--no-workspace', '--vcs', 'none'],
      ['uv', 'add', 'fastapi[standard]'],
      ['uv', 'add', '--dev', 'pytest'],
    ],
    dev: ['uv', 'run', 'fastapi', 'dev', 'main.py'],
    build: null,
    test: ['uv', 'run', 'pytest'],
    readyText: 'Application startup complete',
    database: false,
    migrate: null,
    ignore: ['.venv/', '__pycache__/', '*.pyc', '.env', '.DS_Store'],
  },
  rails: {
    id: 'rails',
    framework: true,
    name: 'Rails',
    summary: 'Rails with a Postgres database',
    generator: [['rails', 'new', '.', '--database=postgresql', '--skip-git']],
    dev: ['bin/rails', 'server'],
    build: ['bin/rails', 'assets:precompile'],
    test: ['bin/rails', 'test'],
    readyText: 'Listening on',
    database: true,
    migrate: ['bin/rails', 'db:migrate'],
    ignore: [],
  },
  go: {
    id: 'go',
    framework: false,
    name: 'Go',
    summary: 'A Go web service',
    generator: [],
    dev: ['go', 'run', '.'],
    build: ['go', 'build', './...'],
    test: ['go', 'test', './...'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: ['/bin/', '.env', '.DS_Store'],
  },
  rust: {
    id: 'rust',
    framework: false,
    name: 'Rust',
    summary: 'A Rust program with Cargo',
    generator: [['cargo', 'init', '--vcs', 'none']],
    dev: ['cargo', 'run'],
    build: ['cargo', 'build'],
    test: ['cargo', 'test'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: ['/target/', '.env', '.DS_Store'],
    prerequisites: RUST,
  },
  swift: {
    id: 'swift',
    framework: false,
    name: 'Swift',
    summary: 'A Swift package with a command-line program',
    generator: [['swift', 'package', 'init', '--type', 'executable']],
    dev: ['swift', 'run'],
    build: ['swift', 'build'],
    test: ['swift', 'test'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: ['.build/', '.swiftpm/', '.DS_Store'],
    prerequisites: 'Swift, from Xcode or swift.org (https://www.swift.org/install/)',
  },
  tauri: {
    id: 'tauri',
    framework: true,
    name: 'Tauri',
    summary: 'A Tauri desktop app with React and TypeScript',
    generator: [
      ['npx', '--yes', 'create-tauri-app@latest', '.', '--template', 'react-ts', '--manager', 'npm', '--yes'],
      ['npm', 'install'],
    ],
    dev: ['npm', 'run', 'tauri', 'dev'],
    build: ['npm', 'run', 'build'],
    test: ['cargo', 'check', '--manifest-path', 'src-tauri/Cargo.toml'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: [...NODE_IGNORE, 'src-tauri/target/'],
    prerequisites: `${RUST} and Tauri's system prerequisites (https://v2.tauri.app/start/prerequisites/)`,
    installed: true,
  },
  electron: {
    id: 'electron',
    framework: true,
    name: 'Electron',
    summary: 'An Electron desktop app with Vite and TypeScript',
    generator: [['npx', '--yes', 'create-electron-app@latest', '.', '--template', 'vite', '--typescript']],
    dev: ['npm', 'start'],
    build: ['npm', 'run', 'package'],
    test: ['npm', 'run', 'lint'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: [...NODE_IGNORE, 'out/', '.vite/'],
    installed: true,
  },
  flutter: {
    id: 'flutter',
    framework: true,
    name: 'Flutter',
    summary: 'A Flutter app for phones, desktop and the web',
    generator: [['flutter', 'create', '--project-name', '{package}', '.']],
    dev: ['flutter', 'run'],
    build: ['flutter', 'analyze'],
    test: ['flutter', 'test'],
    readyText: null,
    database: false,
    migrate: null,
    ignore: ['.dart_tool/', 'build/', '.DS_Store'],
    prerequisites: 'the Flutter SDK (https://docs.flutter.dev/get-started/install)',
    installed: true,
  },
}

/** The smallest stack that does the job: static pages first, a full framework only when the app needs one. */
export function chooseStack(answers: StackAnswers): StackId {
  if (answers.kind === 'phone') return answers.language === 'dart' ? 'flutter' : 'expo'
  // Tauri ships a far smaller app than Electron; Electron when the person asks for JavaScript all the way down.
  if (answers.kind === 'desktop') return answers.language === 'javascript' ? 'electron' : 'tauri'
  if (answers.language === 'rust') return 'rust'
  if (answers.language === 'swift') return 'swift'
  if (answers.language === 'python') return answers.kind === 'api' ? 'fastapi' : 'django'
  if (answers.language === 'ruby') return 'rails'
  if (answers.language === 'go') return 'go'
  // No framework until the app needs what one brings: sign-in, stored data, or many pages to keep in order.
  if (answers.kind === 'api') return answers.signIn || answers.data ? 'node-api' : 'node'
  if (answers.signIn || answers.data) return answers.ui === 'vue' ? 'nuxt' : 'nextjs'
  if (answers.content) return 'astro'
  if (!answers.app) return 'static'
  return answers.ui === 'vue' ? 'vite-vue' : answers.ui === 'react' ? 'vite-react' : 'vite-vanilla'
}

/**
 * A generator step with the project's names filled in: `{name}` is the folder name, `{package}` the same as a package
 * identifier (lowercase letters, digits and underscores, starting with a letter), which Dart and others require.
 */
export function withProjectName(argv: readonly string[], name: string): string[] {
  const lowered = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const identifier = /^[a-z]/.test(lowered) ? lowered : `app_${lowered}`
  return argv.map((arg) => arg.replaceAll('{name}', name).replaceAll('{package}', identifier))
}

/** A command list as one line, for a card or a goal's verification command. Arguments with spaces are quoted. */
export function commandLine(argv: readonly string[]): string {
  return argv.map((arg) => (/^[\w@%+=:,./[\]-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(' ')
}

/** The goal check for a new project: its build, then its tests, where it has them. */
export function stackCheck(stack: StackPlan): string | null {
  const steps = [stack.build, stack.test].filter((step): step is string[] => !!step).map(commandLine)
  return steps.length ? steps.join(' && ') : null
}
