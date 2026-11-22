import { isInteractiveAsset } from '@ramu/shared/interactive'
import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { ArtifactProjectDestination } from '@ramu/shared/api'
import { titleFolderName } from '@ramu/shared/workspace/hostFolders'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { HandlerContext } from '../ipc/types'

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Missing or empty: a folder the artifact's files can go into without overwriting anything. */
const free = (path: string) =>
  readdir(path).then(
    (entries) => !entries.length,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return true
      // A file of that name is taken like a folder with files in it.
      if (error.code === 'ENOTDIR') return false
      throw error
    },
  )

/** `base`, or `base-2`, `base-3`… when that folder already holds files. */
async function freeFolder(root: string, base: string) {
  for (let n = 1; n < 1000; n++) {
    const path = normalize(join(root, n === 1 ? base : `${base}-${n}`))
    if (!inside(root, path)) throw new Error('Choose a folder inside the project.')
    if (await free(path)) return path
  }
  throw new Error('Every folder with that name is taken. Choose another name.')
}

/** A linked folder on the way to `folder` would put the files outside `root`; checked before anything is created. */
async function refuseLinkOut(root: string, folder: string) {
  let existing = folder
  while (existing !== root) {
    const found = await realpath(existing).catch(() => null)
    if (found) {
      if (!inside(root, found)) throw new Error('Choose a folder inside the project.')
      return
    }
    existing = dirname(existing)
  }
}

/** The files an artifact hands a project: a design's frames and source under `design/`, any other kind's own files. */
function artifactFiles(ctx: HandlerContext, artifactId: string) {
  const page = ctx.pages!.get(artifactId)
  const document = ctx.pages!.document(artifactId)
  const design = page.kind === 'design'
  const files = design
    ? [
        {
          path: 'design/frames.html',
          content: interactiveExport(document, null, true).html,
          encoding: 'utf8' as const,
        },
        ...(document.files ?? []).map((file) => ({ ...file, path: `design/${file.path}` })),
      ]
    : (document.files ?? [{ path: 'index.html', content: document.html, encoding: 'utf8' as const }])
  const react = files.some((file) => /\.(tsx|jsx)$/.test(file.path)) || /from ['"]react['"]/.test(document.html)
  return { page, files, design, react }
}

async function writeArtifact(ctx: HandlerContext, artifactId: string, folder: string) {
  const source = artifactFiles(ctx, artifactId)
  const { page, files, design } = source
  await mkdir(folder, { recursive: true })
  for (const file of files) {
    const target = normalize(join(folder, file.path))
    if (!inside(folder, target)) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content)
  }
  const exported = page.grants.records ? ctx.pages!.exportRecords(artifactId) : null
  if (page.capabilities.records) {
    await mkdir(join(folder, 'data'), { recursive: true })
    await writeFile(join(folder, 'data', 'schema.json'), JSON.stringify(page.capabilities.records, null, 2))
    if (exported) await writeFile(join(folder, 'data', 'seed.json'), exported.json)
  }
  await writeFile(
    join(folder, 'README.md'),
    `# ${page.title}\n\nStarted from the Ramu ${design ? 'design' : 'artifact'} "${page.title}" (version ${page.version}).${design ? ' `design/` is the design reference.' : ''}\n${page.capabilities.records ? '\n`data/schema.json` holds the record collections the artifact kept and `data/seed.json` its records.\n' : ''}${files.some(isInteractiveAsset) ? "\nThe artifact's models, textures and sounds are in their folders. Code that called `ramuAsset('<path>')` there loads the same file by its URL here.\n" : ''}`,
  )
  return source
}

/**
 * The brief for the thread that grows the artifact into an app. `at` is the artifact's folder relative to the project
 * root, or empty when the artifact's folder is the project itself.
 */
function brief({ page, design, react }: ReturnType<typeof artifactFiles>, at: string) {
  const here = at ? `${at}/` : ''
  if (design)
    return [
      `${here}design/ holds my Ramu design "${page.title}": ${here}design/frames.html shows its frames and ${here}design/design.json has each frame's HTML and CSS.`,
      at
        ? 'Build the screens these frames show in this project so they match, using its existing stack (ask me at most one question if it is unclear), and keep the design folder as the reference so later screens follow it.'
        : 'Start the app from it: choose a stack that fits (ask me at most one question if it is unclear), build the screens these frames show so they match, and keep design/ as the design reference so later screens follow it.',
      `Run it in a background terminal, open it in the browser panel, compare it with ${here}design/frames.html, then tell me how to deploy it.`,
    ].join('\n')
  return [
    at
      ? `${here} holds the sources of my Ramu artifact "${page.title}". Bring it into this project with the same behavior, using the project's existing stack and conventions where they fit.`
      : `This folder holds the sources of my Ramu artifact "${page.title}". Turn it into a project that builds and runs with the same behavior.`,
    at
      ? ''
      : react
        ? 'It uses React: set it up as a Vite + React + TypeScript app.'
        : 'It is a static page: set it up as a static site with a small build or none.',
    page.capabilities.records
      ? `The artifact kept records on the Ramu host (${here}data/schema.json, ${here}data/seed.json). Replace ramuContent.records with a small local data layer that reads the seed, and say what a real database would need.`
      : '',
    page.capabilities.ai
      ? 'The artifact used ramuContent.ai, which only exists inside Ramu. Move those calls behind one function and say which server-side model call would replace it.'
      : '',
    'Run it in a background terminal, open it in the browser panel, and check it matches the artifact. Then tell me how to deploy it.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function startThread(
  ctx: HandlerContext,
  artifactId: string,
  projectId: string,
  source: ReturnType<typeof artifactFiles>,
  at: string,
) {
  const settings = ctx.pageAi!.settingsFor('smart')
  await ctx.agents.validateSettings(settings)
  const thread = await ctx.agentThreads!.startInProject(
    {
      projectId,
      title: source.design ? `Build ${source.page.title}` : `Grow ${source.page.title} into an app`,
      prompt: brief(source, at),
    },
    settings,
  )
  ctx.pages!.markGrewInto(artifactId, { projectId, taskId: thread.taskId })
  return thread
}

/**
 * Make it a project. A new project: the artifact's sources, record schemas and records as seed data go to a new
 * folder under `parent` (where new projects usually go when none is chosen), the folder joins the project list, and a
 * thread starts there to grow it into an app. An existing project: the same files go to a folder inside its root, and a
 * thread starts in that project unless `startThread` is false.
 */
export async function makePageProject(
  ctx: HandlerContext,
  artifactId: string,
  destination: ArtifactProjectDestination = { kind: 'new' },
) {
  if (!ctx.pages || !ctx.pageAi || !ctx.agentThreads) throw new Error('Update this host for Artifacts.')
  const title = ctx.pages.get(artifactId).title
  if (destination.kind === 'project') {
    const project = ctx.workspace.listProjects().find((entry) => entry.id === destination.projectId)
    if (!project) throw new Error('That project is not on this host.')
    const root = project.root ?? ctx.workspace.listRepositories(project.id)[0]?.root
    if (!root) throw new Error('This project has no folder to put the artifact in.')
    const actual = await realpath(root).catch(() => {
      throw new Error('The project folder is missing on this host.')
    })
    const folder = await freeFolder(actual, destination.folder ?? titleFolderName(title))
    await refuseLinkOut(actual, folder)
    const source = await writeArtifact(ctx, artifactId, folder)
    const at = relative(actual, folder).split(sep).join('/')
    const thread = destination.startThread === false ? null : await startThread(ctx, artifactId, project.id, source, at)
    if (!thread) ctx.pages.markGrewInto(artifactId, { projectId: project.id })
    return { projectId: project.id, folder, thread }
  }
  const parent = await ctx.hostFolders.inspect(destination.parent ?? ctx.workspace.newProjectParent(true))
  if (destination.parent) ctx.workspace.rememberProjectParent(parent)
  const folder = await freeFolder(parent, destination.name ?? titleFolderName(title))
  const source = await writeArtifact(ctx, artifactId, folder)
  const { project } = await ctx.workspace.addProjectFromFolder(folder)
  const thread = await startThread(ctx, artifactId, project.id, source, '')
  return { projectId: project.id, folder, thread }
}
