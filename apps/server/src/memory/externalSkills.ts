import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, lstatSync, rmSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { NO_PROJECT, type ManagedSkill, type SkillInstallPreview } from '@ramu/shared/types'
import type { LearningService } from './learning'
import type { Workspace } from '../workspace/workspace'
import type { AgentService } from '../agent'
import { findExecutable } from '../providers/providerBinaries'
import { readSkillFolder, skillMetadata } from './skillFiles'

export const SKILLS_CLI_VERSION = '1.7.2'
export const skillInstallInput = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .refine((s) => !s.startsWith('-'), 'Invalid skill source'),
  skill: z
    .string()
    .min(1)
    .max(100)
    .refine((s) => !s.startsWith('-'))
    .optional(),
  projectId: z.string().min(1).max(100).nullable(),
  updatingId: z.string().max(100).optional(),
})
type Input = z.infer<typeof skillInstallInput>
type Staged = {
  preview: SkillInstallPreview
  files: Record<string, string>
  scripts: Set<string>
  expires: number
  expectedRevision?: number
  owner?: string
}

export class ExternalSkills {
  private staged = new Map<string, Staged>()
  constructor(
    private learning: LearningService,
    private workspace: Workspace,
  ) {}
  availability() {
    return { available: !!findExecutable('npx'), installUrl: 'https://nodejs.org/en/download' }
  }
  private run(args: string[], cwd: string): Promise<string> {
    const npx = findExecutable('npx')
    if (!npx) throw new Error('Install Node.js to get npx: https://nodejs.org/en/download')
    const entry =
      process.platform === 'win32' && /\.cmd$/i.test(npx)
        ? join(dirname(npx), 'node_modules', 'npm', 'bin', 'npx-cli.js')
        : null
    if (entry && !existsSync(entry))
      throw new Error('Reinstall Node.js so npx-cli.js is available: https://nodejs.org/en/download')
    return new Promise((resolve, reject) =>
      execFile(
        entry ? process.execPath : npx,
        [...(entry ? [entry] : []), '--yes', `skills@${SKILLS_CLI_VERSION}`, ...args],
        {
          cwd,
          encoding: 'utf8',
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            DISABLE_TELEMETRY: '1',
            DO_NOT_TRACK: '1',
            CI: '1',
            GIT_TERMINAL_PROMPT: '0',
            NO_COLOR: '1',
          },
        },
        (error, stdout, stderr) =>
          error
            ? reject(new Error((stderr || error.message).slice(-2000)))
            : // eslint-disable-next-line no-control-regex -- CLI color escape sequences.
              resolve(stdout.replace(/\x1b\[[0-9;]*m/g, '')),
      ),
    )
  }
  async find(query: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'ramu-skill-find-'))
    try {
      return await this.run(['find', query], dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  async stage(raw: Input, owner?: string): Promise<SkillInstallPreview> {
    const input = skillInstallInput.parse(raw)
    if (input.projectId === NO_PROJECT) throw new Error('Choose a project or use user scope.')
    if (input.projectId && !this.workspace.listProjects().some((p) => p.id === input.projectId))
      throw new Error('Unknown project.')
    const existing = input.updatingId ? this.installed(input.updatingId) : undefined
    if (existing && (existing.projectId !== input.projectId || existing.installation!.source !== input.source))
      throw new Error('The skill scope or source changed. Refresh before updating.')
    const source = input.source.startsWith('.') || isAbsolute(input.source) ? resolve(input.source) : input.source
    if (isAbsolute(source)) {
      // Reject local links before the CLI can dereference them while copying.
      let scanned = 0
      const check = (path: string, depth: number) => {
        if (++scanned > 20000 || depth > 32)
          throw new Error('Local source is too large to inspect. Use the individual skill folder.')
        const stat = lstatSync(path)
        if (stat.isSymbolicLink()) throw new Error('Local skill sources cannot contain symlinks.')
        if (stat.isDirectory())
          for (const name of readdirSync(path))
            if (!['.git', 'node_modules'].includes(name)) check(join(path, name), depth + 1)
      }
      check(source, 0)
    }
    const dir = mkdtempSync(join(tmpdir(), 'ramu-skill-stage-'))
    try {
      // A marker prevents the CLI from mistaking a parent directory for the project root.
      mkdirSync(join(dir, '.git'))
      await this.run(['add', source, '-s', input.skill ?? '*', '-a', 'codex', '--copy', '-y'], dir)
      const roots = [join(dir, '.agents', 'skills'), join(dir, '.codex', 'skills')]
      const folders = new Map<string, string>()
      for (const parent of ['.agents', '.codex']) {
        try {
          if (lstatSync(join(dir, parent)).isSymbolicLink())
            throw new Error('Skill staging parent cannot be a symlink.')
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
        }
      }
      for (const root of roots) {
        let entries: string[] = []
        try {
          entries = readdirSync(root)
        } catch {
          continue
        }
        if (lstatSync(root).isSymbolicLink()) throw new Error('Skill staging folder cannot be a symlink.')
        for (const entry of entries) if (!folders.has(entry)) folders.set(entry, join(root, entry))
      }
      if (folders.size !== 1)
        throw new Error(`Choose one skill by name. Found: ${[...folders.keys()].slice(0, 50).join(', ') || 'none'}`)
      const folder = [...folders.values()][0]!
      const { markdown, files, scripts } = readSkillFolder(folder),
        { name, description } = skillMetadata(markdown)
      const prior = existing?.installation!.files ?? {}
      const preview: SkillInstallPreview = {
        id: randomUUID(),
        source,
        projectId: input.projectId,
        name,
        description,
        markdown,
        files: Object.entries(files).map(([path, data]) => ({
          path,
          bytes: Buffer.from(data, 'base64').length,
          script: scripts.has(path),
        })),
        updatingId: existing?.id,
        changes: {
          added: Object.keys(files).filter((p) => !(p in prior)),
          changed: Object.keys(files).filter((p) => p in prior && files[p] !== prior[p]),
          removed: Object.keys(prior).filter((p) => !(p in files)),
        },
      }
      for (const [id, staged] of this.staged) if (staged.expires < Date.now()) this.staged.delete(id)
      if (this.staged.size >= 20) throw new Error('Too many pending skill installs. Confirm or cancel one first.')
      this.staged.set(preview.id, {
        preview,
        files,
        scripts,
        expires: Date.now() + 30 * 60_000,
        expectedRevision: existing?.revision,
        owner,
      })
      return preview
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  confirm(id: string, includeScripts: boolean, owner?: string): ManagedSkill {
    const staged = this.staged.get(id)
    if (!staged || staged.expires < Date.now() || staged.owner !== owner)
      throw new Error('This preview expired or belongs to another request. Stage the skill again.')
    const { preview, files, scripts } = staged
    const old = preview.updatingId ? this.installed(preview.updatingId) : undefined
    if (old && old.revision !== staged.expectedRevision)
      throw new Error('Skill changed while awaiting approval. Preview it again.')
    if (
      this.learning
        .skills()
        .some((s) => s.name === preview.name && s.projectId === preview.projectId && s.id !== old?.id)
    )
      throw new Error('A skill with this name already exists in that scope.')
    const { content } = skillMetadata(preview.markdown),
      now = Date.now()
    const skill: ManagedSkill = {
      id: old?.id ?? randomUUID(),
      projectId: preview.projectId,
      name: preview.name,
      description: preview.description,
      content,
      pinned: true,
      status: old?.status ?? 'active',
      revision: (old?.revision ?? 0) + 1,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: old?.lastUsedAt ?? null,
      useCount: old?.useCount ?? 0,
      sourceSessionId: '',
      sourceSeq: 0,
      changedBy: 'user',
      installation: {
        source: preview.source,
        skill: preview.name,
        cliVersion: SKILLS_CLI_VERSION,
        markdown: preview.markdown,
        files: Object.fromEntries(Object.entries(files).filter(([path]) => includeScripts || !scripts.has(path))),
      },
    }
    this.learning.write(skill)
    this.staged.delete(id)
    return skill
  }
  cancel(id: string, owner?: string) {
    if (this.staged.get(id)?.owner === owner) this.staged.delete(id)
  }
  installed(id: string): ManagedSkill {
    const skill = this.learning.skills().find((s) => s.id === id && s.installation)
    if (!skill) throw new Error('Unknown installed skill.')
    return skill
  }
  move(id: string, projectId: string | null) {
    const skill = this.installed(id)
    if (projectId && !this.workspace.listProjects().some((p) => p.id === projectId)) throw new Error('Unknown project.')
    if (this.learning.skills().some((s) => s.id !== id && s.name === skill.name && s.projectId === projectId))
      throw new Error('A skill with that name already exists in the destination.')
    this.learning.write({ ...skill, projectId, revision: skill.revision + 1, updatedAt: Date.now() })
  }
  remove(id: string) {
    this.installed(id)
    this.learning.remove(id)
  }
  update(id: string, owner?: string) {
    const skill = this.installed(id)
    return this.stage(
      {
        source: skill.installation!.source,
        skill: skill.installation!.skill,
        projectId: skill.projectId,
        updatingId: id,
      },
      owner,
    )
  }

  register(server: McpServer, agents: AgentService, sessionId: string) {
    const project = this.workspace.projectIdOf(agents.get(sessionId).taskId)
    const accessible = (id: string) => {
      const skill = this.installed(id)
      if (skill.projectId && skill.projectId !== project) throw new Error('Skill belongs to another project.')
      return skill
    }
    const result = async (op: () => unknown) => {
      try {
        return { content: [{ type: 'text' as const, text: JSON.stringify(await op()) }] }
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }
      }
    }
    const ask = async (question: string, options: string[], signal?: AbortSignal) => {
      const reply = await agents.askQuestion(
        sessionId,
        {
          blocking: true,
          questions: [
            {
              id: 'choice',
              question,
              header: 'Skills',
              multiSelect: false,
              options: options.map((label) => ({ label, description: '' })),
            },
          ],
        },
        signal,
      )
      return reply.answers.choice
    }
    const approve = async (preview: SkillInstallPreview, signal?: AbortSignal) => {
      try {
        if (
          (await ask(
            `Install ${preview.name}?\n${preview.description}\nSource: ${preview.source}\nScope: ${preview.projectId ? 'project' : 'user'}\nFiles:\n${preview.files.map((f) => `${f.path}${f.script ? ' [script, separate approval]' : ''}`).join('\n')}\nChanges: ${JSON.stringify(preview.changes)}`,
            ['Install', 'Cancel'],
            signal,
          )) !== 'Install'
        )
          return { cancelled: true }
        const scripts = preview.files.filter((f) => f.script)
        const include =
          scripts.length > 0 &&
          (await ask(
            `Also copy these scripts? Ramu does not run them.\n${scripts.map((f) => f.path).join('\n')}`,
            ['Skip scripts', 'Include scripts'],
            signal,
          )) === 'Include scripts'
        const skill = this.confirm(preview.id, include, sessionId)
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          projectId: skill.projectId,
          status: skill.status,
          source: skill.installation!.source,
          files: Object.keys(skill.installation!.files),
        }
      } finally {
        this.cancel(preview.id, sessionId)
      }
    }
    server.registerTool(
      'skill_find',
      {
        description:
          'Find external skills by keyword with the pinned skills.sh CLI. Requires npx; does not install anything.',
        inputSchema: {
          query: z
            .string()
            .trim()
            .min(1)
            .max(300)
            .refine((s) => !s.startsWith('-')),
        },
      },
      ({ query }) => result(() => this.find(query)),
    )
    server.registerTool(
      'skill_inspect',
      {
        description:
          'Read the approved instructions, scope, source and file list of an installed external skill available to this project.',
        inputSchema: { id: z.string() },
      },
      ({ id }) =>
        result(() => {
          const skill = accessible(id)
          return {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            projectId: skill.projectId,
            status: skill.status,
            source: skill.installation!.source,
            markdown: skill.installation!.markdown,
            content: skill.content,
            files: Object.keys(skill.installation!.files),
          }
        }),
    )
    server.registerTool(
      'skill_install',
      {
        description:
          'Stage one external skill from owner/repo, URL, git address or an absolute local path. Ask the user scope when omitted, then show files and wait for user approval; scripts require separate approval. Never runs skill scripts.',
        inputSchema: {
          source: skillInstallInput.shape.source,
          skill: skillInstallInput.shape.skill,
          scope: z.enum(['user', 'project']).optional(),
        },
      },
      (input, extra) =>
        result(async () => {
          const scope =
            input.scope ??
            (await ask(
              'Where should this skill be available?',
              ['This project', 'All projects', 'Cancel'],
              extra.signal,
            ))
          if (scope === 'Cancel') return { cancelled: true }
          if (!['user', 'project', 'All projects', 'This project'].includes(scope ?? ''))
            throw new Error('Choose user or project scope explicitly.')
          const user = scope === 'user' || scope === 'All projects'
          if (!user && project === NO_PROJECT) throw new Error('Open a project thread to install project skills.')
          return approve(
            await this.stage(
              {
                source: input.source.startsWith('.') ? resolve(agents.get(sessionId).cwd, input.source) : input.source,
                skill: input.skill,
                projectId: user ? null : project,
              },
              sessionId,
            ),
            extra.signal,
          )
        }),
    )
    server.registerTool(
      'skill_list',
      {
        description: 'List installed external skills available to this project, with scope, source and status.',
        inputSchema: {},
      },
      () =>
        result(() =>
          this.learning
            .skills()
            .filter((s) => s.installation && (!s.projectId || s.projectId === project))
            .map(({ installation, content: _content, ...s }) => ({ ...s, source: installation!.source })),
        ),
    )
    server.registerTool(
      'skill_update_from_source',
      {
        description: 'Stage an installed skill from its original source, show changed files, and ask for approval.',
        inputSchema: { id: z.string() },
      },
      ({ id }, extra) =>
        result(async () => {
          accessible(id)
          return approve(await this.update(id, sessionId), extra.signal)
        }),
    )
    server.registerTool(
      'skill_remove',
      {
        description: 'Remove an installed external skill from Ramu and its provider exports after user confirmation.',
        inputSchema: { id: z.string() },
      },
      ({ id }, extra) =>
        result(async () => {
          const skill = accessible(id)
          if (
            (await ask(
              `Remove ${skill.name} from Ramu and all provider exports?`,
              ['Remove', 'Cancel'],
              extra.signal,
            )) === 'Remove'
          )
            this.remove(id)
          return { removed: !this.learning.skills().some((s) => s.id === id) }
        }),
    )
    server.registerTool(
      'skill_disable',
      {
        description: 'Disable or enable an installed external skill. Its source and files are kept.',
        inputSchema: { id: z.string(), disabled: z.boolean() },
      },
      ({ id, disabled }) =>
        result(() => {
          accessible(id)
          return this.learning.control(id, disabled ? 'disable' : 'restore')
        }),
    )
    server.registerTool(
      'skill_move',
      {
        description: 'Move an installed external skill between this project and all projects, after user confirmation.',
        inputSchema: { id: z.string(), scope: z.enum(['user', 'project']) },
      },
      ({ id, scope }, extra) =>
        result(async () => {
          const skill = accessible(id)
          if (scope === 'project' && project === NO_PROJECT) throw new Error('Open a project first.')
          const approved =
            (await ask(`Move ${skill.name} to ${scope} scope?`, ['Move', 'Cancel'], extra.signal)) === 'Move'
          if (approved) this.move(id, scope === 'user' ? null : project)
          return { moved: approved }
        }),
    )
  }
}
