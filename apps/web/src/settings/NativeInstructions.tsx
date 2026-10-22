import { useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { providerName } from '@ramu/shared/providers/providers'
import { estimatedTokens } from '@ramu/shared/rules'
import type { NativeInstructionFile, NativeInstructionInclude } from '@ramu/shared/types'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Field, FieldLabel } from '@/components/ui/field'
import { SettingsGroupTitle } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { SettingsCard, SettingsCardList } from './cards'
import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'

const CAPTION = 'm-0 text-caption text-muted-foreground'
const NONE = ''

const includeNote = (status: NativeInstructionInclude['status']) => {
  switch (status) {
    case 'read':
      return t('Included')
    case 'missing':
      return t('Not found')
    case 'outside-allowed-folders':
      return t('Outside the project, not read')
    case 'cycle':
      return t('Repeats an earlier include')
    case 'too-deep':
      return t('Nested too deeply, not read')
    case 'too-large':
      return t('Too large, not read')
    case 'not-a-file':
      return t('Not a file')
    case 'limit':
      return t('Too many includes, not read')
  }
}

const activationNote = (file: NativeInstructionFile) =>
  file.activation === 'path-matched'
    ? t('Applies only to matching paths, decided by the provider')
    : file.activation === 'always'
      ? t('Read at the start of a session')
      : t('Activation set by the provider')

/** The meta line of a file: scope, nested folder, readers, size. */
function fileMeta(file: NativeInstructionFile): string {
  return [
    file.scope === 'user' ? t('Your account on this host') : file.label,
    file.nested ? t('Folder {0}', { '0': file.nested }) : null,
    file.readBy.length ? t('Read by {0}', { '0': file.readBy.map(providerName).join(', ') }) : null,
    file.problem ? null : t('About {0} tokens', { '0': estimatedTokens(file.characters).toLocaleString() }),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Settings → Agent setup → Rules → files providers read on their own. This is an inventory only: Ramu does not edit,
 * import or send these files, so they stay owned by their repository or the provider.
 */
export function NativeInstructions({ projects }: { projects: { id: string; name: string }[] }) {
  useLanguage()
  const invoke = useSettingsInvoke()
  const scope = useContext(SettingsScopeContext)
  const hostKey = scope?.primaryId ?? ''
  const ready = !scope || (scope.ready && !scope.stale)
  const [projectId, setProjectId] = useState(NONE)
  const files = useQuery({
    queryKey: ['native-instructions', hostKey, projectId],
    queryFn: () => invoke('rules.native', projectId || null),
    enabled: ready,
  })
  return (
    <>
      <SettingsGroupTitle className="mt-8">{t('Instruction files providers read')}</SettingsGroupTitle>
      <p className={`${CAPTION} mb-3`}>
        {t(
          'AGENTS.md, CLAUDE.md and rules folders are loaded by each provider itself. Ramu only lists them here and never changes or sends them.',
        )}
      </p>
      <Field className="mb-3">
        <FieldLabel className="flex-col items-stretch">
          {t('Project')}
          <Dropdown
            label={t('Project')}
            value={projectId}
            options={[
              { value: NONE, label: t('Your account only') },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={setProjectId}
          />
        </FieldLabel>
      </Field>
      {files.error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{errorText(files.error)}</AlertDescription>
        </Alert>
      )}
      <SettingsCardList>
        {(files.data?.files ?? []).map((file) => (
          <SettingsCard key={`${file.scope}:${file.path}`} title={file.path} meta={fileMeta(file)}>
            {file.problem ? (
              <p role="note" className="m-0 text-caption text-foreground">
                {t(file.problem)}
              </p>
            ) : (
              <details className={CAPTION}>
                <summary className="cursor-pointer select-none">
                  {activationNote(file)}
                  {file.frontmatterKeys.length
                    ? ` · ${t('Frontmatter: {0}', { '0': file.frontmatterKeys.join(', ') })}`
                    : ''}
                </summary>
                <pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-caption">
                  {file.text}
                  {file.truncated ? `\n…${t('Shortened here; the provider reads the whole file.')}` : ''}
                </pre>
                {file.includes.length > 0 && (
                  <ul className="m-0 mt-1 list-none p-0">
                    {file.includes.map((include) => (
                      <li key={include.reference}>
                        @{include.reference} · {includeNote(include.status)}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </SettingsCard>
        ))}
      </SettingsCardList>
      {files.data?.files.length === 0 && <p className={CAPTION}>{t('No instruction files found.')}</p>}
    </>
  )
}
