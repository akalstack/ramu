import type { ReactNode } from 'react'
import { BarChart3, BookOpen, Bot, FileText, KeyRound, Server, Sparkles, SquareTerminal } from 'lucide-react'
import { ABILITY_LABELS } from '@ramu/shared/providers/abilities'
import { UNUSED_PART_NAMES, type PluginContents, type PluginSourceInfo } from '@ramu/shared/plugins'
import { Badge } from '@/components/ui/badge'
import { t, useLanguage } from '../i18n'
import { ExtensionIcon } from './parts'

/** How many of a long list show before "and N more" opens the rest. */
const SHOWN = 3

function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-2 [&+&]:border-t [&+&]:border-line">
      <span className="mt-0.5 flex size-5 flex-none items-center justify-center text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-control font-medium text-foreground">{title}</span>
        <div className="min-w-0 text-caption text-muted-foreground">{children}</div>
      </div>
    </li>
  )
}

/** A list that stays short however much a plugin brings: the first few, then the rest on demand. */
function Short<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const head = items.slice(0, SHOWN)
  const rest = items.slice(SHOWN)
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {head.map((item, index) => (
        <li key={index} className="min-w-0">
          {render(item)}
        </li>
      ))}
      {rest.length > 0 && (
        <li>
          <details>
            <summary className="cursor-pointer text-soft">{t('and {0} more', { '0': rest.length })}</summary>
            <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
              {rest.map((item, index) => (
                <li key={index} className="min-w-0">
                  {render(item)}
                </li>
              ))}
            </ul>
          </details>
        </li>
      )}
    </ul>
  )
}

/** Everything a plugin adds, one kind per row with what it means for the person, read before and after installing. */
export function PluginParts({ contents }: { contents: PluginContents }) {
  useLanguage()
  return (
    <ul className="m-0 list-none p-0" aria-label={t('What it adds')}>
      {contents.skills.length > 0 && (
        <Part
          icon={<BookOpen size={15} />}
          title={contents.skills.length === 1 ? t('1 skill') : t('{0} skills', { '0': contents.skills.length })}
        >
          <Short
            items={contents.skills}
            render={(skill) => (
              <span className="block truncate" title={skill.description}>
                <span className="text-soft">{skill.name}</span>
                {skill.description ? ` — ${skill.description}` : ''}
              </span>
            )}
          />
        </Part>
      )}
      {contents.mcpServers.length > 0 && (
        <Part
          icon={<Server size={15} />}
          title={
            contents.mcpServers.length === 1
              ? t('1 MCP server')
              : t('{0} MCP servers', { '0': contents.mcpServers.length })
          }
        >
          <Short
            items={contents.mcpServers}
            render={(server) => (
              <code
                className="block truncate font-mono text-[11px]"
                title={server.type === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}
              >
                {server.type === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}
              </code>
            )}
          />
        </Part>
      )}
      {contents.credentials.length > 0 && (
        <Part icon={<KeyRound size={15} />} title={t('Asks for')}>
          {contents.credentials.map((slot) => slot.label).join(', ')}.{' '}
          {t('You paste it on the plugin here; agents never see it.')}
        </Part>
      )}
      {contents.cli && (
        <Part icon={<SquareTerminal size={15} />} title={t('Runs {0}', { '0': contents.cli.binaries[0] ?? '' })}>
          {contents.cli.reads.length ? (
            <>
              <span className="mb-1 block">{t('These run without asking; every other command asks you:')}</span>
              <span className="flex flex-wrap gap-1">
                {contents.cli.reads.map((read) => (
                  <code
                    key={read}
                    className="rounded-(--radius-xs) bg-fill px-1.5 py-0.5 font-mono text-[11px] text-soft"
                  >
                    {read}
                  </code>
                ))}
              </span>
            </>
          ) : (
            t('Every command asks you first.')
          )}
        </Part>
      )}
      {contents.abilities.length > 0 && (
        <Part icon={<Sparkles size={15} />} title={t('Abilities')}>
          {contents.abilities.map((entry) => t(ABILITY_LABELS[entry.ability])).join(', ')}
        </Part>
      )}
      {contents.dataSources.length > 0 && (
        <Part icon={<BarChart3 size={15} />} title={t('Dashboard data')}>
          {contents.dataSources.map((entry) => entry.label).join(', ')}
        </Part>
      )}
      {contents.agents.length > 0 && (
        <Part icon={<Bot size={15} />} title={t('Custom agents')}>
          {contents.agents.map((agent) => agent.name).join(', ')}
        </Part>
      )}
      {contents.rule && (
        <Part icon={<FileText size={15} />} title={t('A rule')}>
          {t('Instructions from its AGENTS.md, given to every agent.')}
        </Part>
      )}
      {contents.unused.length > 0 && (
        <li className="pt-2 text-caption text-muted-foreground">
          {t('Not used in Ramu: {parts}', {
            parts: contents.unused.map((part) => t(UNUSED_PART_NAMES[part])).join(', '),
          })}
        </li>
      )}
    </ul>
  )
}

/** The plugin's tile, name and who made it, with whether it is Ramu's own and signed. */
export function PluginHeading({
  contents,
  source,
  byRamu,
}: {
  contents: PluginContents
  source: PluginSourceInfo
  byRamu: boolean
}) {
  useLanguage()
  return (
    <div className="flex items-start gap-3">
      <ExtensionIcon name={contents.name} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {contents.description && <p className="m-0 text-control text-soft">{contents.description}</p>}
        <div className="flex flex-wrap items-center gap-1">
          {byRamu && <Badge variant="secondary">{t('By Ramu')}</Badge>}
          <Badge variant="outline">
            {source.signedBy ? t('Signed by {name}', { name: source.signedBy }) : t('Unsigned')}
          </Badge>
          <span className="text-caption text-muted-foreground">
            {[
              contents.author ? t('By {author}', { author: contents.author }) : '',
              contents.version ? `v${contents.version}` : '',
              contents.license ?? '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Where the plugin comes from, in one quiet line under the details. */
export function PluginSource({ source }: { source: PluginSourceInfo }) {
  return (
    <p className="m-0 truncate text-caption text-muted-foreground" title={source.location}>
      {[
        source.location.replace(/^https:\/\/github\.com\//, ''),
        source.path,
        source.commit ? source.commit.slice(0, 12) : t('Folder on this computer'),
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  )
}
