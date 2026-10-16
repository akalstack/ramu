// Which e2e specs a change can break. `node e2e/run.mjs --changed` uses this to run only those, like a unit-test
// watcher: each rule maps changed paths to the specs that exercise them. Keep rules coarse; when unsure, add the spec.

/** Paths that never need a desktop run: docs, unit tests, the mobile app and the website. */
const IGNORED = [
  /\.md$/,
  /^docs\//,
  /^assets\//,
  /^apps\/(mobile|site)\//,
  /^apps\/[^/]+\/test\//,
  /^packages\/[^/]+\/test\//,
  /^\.github\//,
  /^output\//,
  /^e2e\/output\//,
]

/** [path pattern, specs]. A path can match several rules. */
const RULES = [
  // Home, Inbox and the start box.
  [/^apps\/web\/src\/(Home|HomeAgents|HomeSection|NewTask|Onboarding)\.tsx$/, ['comparison-plan', 'summaries', 'chat']],
  [/^apps\/web\/src\/inbox\//, ['comparison-plan', 'settings', 'summaries']],
  [/^apps\/web\/src\/summaries\//, ['summaries', 'learning']],
  [/^apps\/web\/src\/Automation\.tsx$/, ['background', 'settings']],
  // Threads.
  [/^apps\/web\/src\/(chat|views|composer)\//, ['chat', 'agent-input', 'markdown']],
  [/^apps\/web\/src\/chat\/(Goal|goal)/, ['goals']],
  [/^apps\/web\/src\/(chat\/ChatReferences|sidebar\/explorer\/)/, ['explorer-drop', 'markdown']],
  [/^apps\/web\/src\/views\/agent\/components\/(AdvisorActivity|Aside)/, ['advisor']],
  [/^apps\/web\/src\/models\//, ['model-bar']],
  // Workspace, editor, terminals, Git.
  [/^apps\/web\/src\/editor\//, ['editor']],
  [
    /^apps\/web\/src\/sidebar\/(scm|CommitHistoryRow|StashRow)|^apps\/web\/src\/(git|changes)\//,
    ['source-control', 'review'],
  ],
  [/^apps\/web\/src\/sidebar\/(projects|ProjectsPanel)/, ['projects', 'workspace']],
  [/^apps\/web\/src\/sidebar\/Search/, ['workspace']],
  [/[Tt]erminal/, ['terminal', 'terminal-tabs']],
  [/^apps\/web\/src\/workspace\//, ['workspace', 'layout', 'panels']],
  [/^apps\/web\/src\/palette\/|^apps\/web\/src\/commands\.tsx$/, ['command-palette']],
  [/^apps\/web\/src\/settings\//, ['settings']],
  // Shell and shared look: anything on every screen.
  [
    /^apps\/web\/src\/(App\.tsx|styles\.css|ui\.css|chat\.css|motion\.css|Menu\.tsx|components\/)/,
    ['layout', 'panels', 'icon-ux', 'chat'],
  ],
  [/^packages\/shared\/src\/locales\/|^apps\/web\/src\/i18n\.ts$|localization/, ['i18n']],
  // Desktop shell and service.
  [/^apps\/desktop\/src\//, ['layout', 'remote-access', 'i18n']],
  [/^apps\/server\/src\/(agent|agent\.ts|providers\/)/, ['chat', 'agent-input', 'goals', 'compaction', 'advisor']],
  [/^apps\/server\/src\/providers\/(acp|opencode|cursor|antigravity)/, ['providers-acp']],
  [/^apps\/server\/src\/memory\//, ['learning', 'summaries', 'recall']],
  [/^apps\/server\/src\/background\//, ['background', 'pull-request-watch']],
  [/^apps\/server\/src\/remote\//, ['remote-access', 'remote-cycle', 'mobile']],
  [/^apps\/server\/src\/workspace\//, ['workspace', 'projects', 'source-control']],
  [/^apps\/server\/src\/review\//, ['review']],
  [/^apps\/server\/src\/ipc\//, ['settings', 'workspace']],
]

/** What runs when a source file matches no rule: a short smoke run rather than nothing. */
const SMOKE = ['layout', 'chat']

/**
 * The specs to run for `files`, each with the paths that selected it. `available` is the list of spec names on disk,
 * so rules naming a missing spec are ignored. Returns `all: true` when the e2e harness itself changed.
 */
export function impactedSpecs(files, available) {
  const picked = new Map()
  const add = (spec, why) => {
    if (!available.includes(spec)) return
    if (!picked.has(spec)) picked.set(spec, new Set())
    picked.get(spec).add(why)
  }
  for (const file of files) {
    if (/^e2e\/support\//.test(file) || file === 'pnpm-lock.yaml') return { all: true, why: file }
    const spec = /^e2e\/specs\/(.+)\.spec\.mjs$/.exec(file)?.[1]
    if (spec) {
      add(spec, file)
      continue
    }
    if (IGNORED.some((pattern) => pattern.test(file)) || !/^(apps|packages)\//.test(file)) continue
    const rules = RULES.filter(([pattern]) => pattern.test(file))
    if (rules.length) for (const [, specs] of rules) for (const name of specs) add(name, file)
    else for (const name of SMOKE) add(name, `${file} (no rule, smoke)`)
  }
  return { all: false, specs: [...picked].map(([name, why]) => ({ name, why: [...why] })) }
}
