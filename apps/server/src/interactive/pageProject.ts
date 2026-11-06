import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import type { HandlerContext } from '../ipc/types'

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'page'

/**
 * Make it a project: the page's sources, its record schemas and its records as seed data are written to a new folder,
 * the folder becomes a project, and a thread starts there with the page as context to grow it into an app.
 */
export async function makePageProject(ctx: HandlerContext, pageId: string, name?: string) {
  if (!ctx.pages || !ctx.pageAi || !ctx.agentThreads) throw new Error('Update this host for Artifacts.')
  const page = ctx.pages.get(pageId)
  const document = ctx.pages.document(pageId)
  const parent = join(homedir(), 'Ramu Projects')
  await mkdir(parent, { recursive: true })
  let folder = join(parent, slug(name ?? page.title))
  for (let n = 2; existsSync(folder); n++) folder = join(parent, `${slug(name ?? page.title)}-${n}`)
  await mkdir(folder)
  const files = document.files ?? [{ path: 'index.html', content: document.html, encoding: 'utf8' as const }]
  for (const file of files) {
    const target = normalize(join(folder, file.path))
    if (!target.startsWith(folder + sep)) continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content)
  }
  const exported = page.grants.records ? ctx.pages.exportRecords(pageId) : null
  if (page.capabilities.records) {
    await mkdir(join(folder, 'data'), { recursive: true })
    await writeFile(join(folder, 'data', 'schema.json'), JSON.stringify(page.capabilities.records, null, 2))
    if (exported) await writeFile(join(folder, 'data', 'seed.json'), exported.json)
  }
  const react = files.some((file) => /\.(tsx|jsx)$/.test(file.path)) || /from ['"]react['"]/.test(document.html)
  await writeFile(
    join(folder, 'README.md'),
    `# ${page.title}\n\nStarted from the Ramu page "${page.title}" (version ${page.version}).\n${page.capabilities.records ? '\n`data/schema.json` holds the record collections the page kept and `data/seed.json` its records.\n' : ''}`,
  )
  const { project } = await ctx.workspace.addProjectFromFolder(folder)
  const settings = ctx.pageAi.settingsFor('smart')
  await ctx.agents.validateSettings(settings)
  const thread = await ctx.agentThreads.startInProject(
    {
      projectId: project.id,
      title: `Grow ${page.title} into an app`,
      prompt: [
        `This folder holds the sources of my Ramu page "${page.title}". Turn it into a project that builds and runs with the same behavior.`,
        react
          ? 'It uses React: set it up as a Vite + React + TypeScript app.'
          : 'It is a static page: set it up as a static site with a small build or none.',
        page.capabilities.records
          ? 'The page kept records on the Ramu host (data/schema.json, data/seed.json). Replace ramuContent.records with a small local data layer that reads the seed, and say what a real database would need.'
          : '',
        page.capabilities.ai
          ? 'The page used ramuContent.ai, which only exists inside Ramu. Move those calls behind one function and say which server-side model call would replace it.'
          : '',
        'Run it in a background terminal, open it in the browser panel, and check it matches the page. Then tell me how to deploy it.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    settings,
  )
  ctx.pages.markGrewInto(pageId, { projectId: project.id, taskId: thread.taskId })
  return { projectId: project.id, folder, thread }
}
