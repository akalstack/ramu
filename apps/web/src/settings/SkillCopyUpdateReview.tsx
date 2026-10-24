import { useRef, useState } from 'react'
import type { SkillCopyUpdate } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, Dropdown } from '../Menu'
import { t } from '../i18n'

type Changes = { description: string; content: string; files: Record<string, 'copy' | 'source'> }

/** A local review draft; the parent applies it with both server revision guards. */
export function SkillCopyUpdateReview({
  preview,
  busy,
  error,
  onCancel,
  onSave,
  readOnly = false,
}: {
  readOnly?: boolean
  preview: SkillCopyUpdate
  busy: boolean
  error: string
  onCancel: () => void
  onSave: (changes: Changes) => void
}) {
  const access = useRef(readOnly)
  access.current = readOnly
  const [copyDraft, setCopyDraft] = useState<Changes>({
    description: preview.description.proposed,
    content: preview.content.proposed,
    files: {},
  })
  const [reviewed, setReviewed] = useState({
    description: !preview.description.conflict,
    content: !preview.content.conflict,
  })
  const [reviewError, setReviewError] = useState('')
  const choose = (field: 'description' | 'content', value: string) => {
    if (access.current) return
    setCopyDraft({ ...copyDraft, [field]: value })
    setReviewed({ ...reviewed, [field]: true })
  }
  return (
    <Dialog
      title={t('Review source changes')}
      confirmLabel={t('Save skill')}
      busy={busy}
      confirmDisabled={readOnly}
      error={reviewError || error}
      onCancel={onCancel}
      onConfirm={() => {
        if (access.current) return
        if (
          !reviewed.description ||
          !reviewed.content ||
          preview.files.some((file) => file.conflict && !copyDraft.files[file.path])
        ) {
          setReviewError(t('Resolve the conflicting versions before saving.'))
          return
        }
        setReviewError('')
        onSave(copyDraft)
      }}
    >
      <fieldset disabled={readOnly} className="contents">
        <p>
          {preview.sourceName} ·{' '}
          {t('Your edits are kept unless you choose the source version. Review the result before saving.')}
        </p>
        {(['description', 'content'] as const).map((field) => {
          const value = preview[field]
          return (
            <section key={field} className="flex flex-col gap-2 mb-3">
              <strong>{field === 'content' ? t('Instructions') : t('When to use it')}</strong>
              {value.conflict && (
                <p className="m-0 text-warn">{t('Both your copy and the source changed. Review this field.')}</p>
              )}
              <details>
                <summary>{t('Compare versions')}</summary>
                <div className="grid gap-2">
                  {[
                    { label: 'Original version', text: value.before },
                    { label: 'Your version', text: value.local },
                    { label: 'Source version', text: value.source },
                  ].map(({ label, text }) => (
                    <div key={label}>
                      <strong>{t(label)}</strong>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-caption">{text}</pre>
                    </div>
                  ))}
                </div>
              </details>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => choose(field, value.local)}>
                  {t('Keep my version')}
                </Button>
                <Button size="sm" onClick={() => choose(field, value.source)}>
                  {t('Use source version')}
                </Button>
              </div>
              <Textarea
                aria-label={field === 'content' ? t('Instructions') : t('When to use it')}
                className={field === 'content' ? 'min-h-40' : ''}
                value={copyDraft[field]}
                onChange={(event) => choose(field, event.target.value)}
              />
            </section>
          )
        })}
        {preview.files.length > 0 && (
          <section>
            <strong>{t('Supporting files')}</strong>
            <ul className="max-h-48 overflow-auto">
              {preview.files.map((file) => (
                <li key={file.path} className="mb-2">
                  <code>{file.path}</code> ·{' '}
                  {t(file.change === 'added' ? 'Added' : file.change === 'removed' ? 'Removed' : 'Changed')}
                  {preview.fileVersions[file.path] && (
                    <details>
                      <summary>{t('Compare versions')}</summary>
                      {(['before', 'local', 'source'] as const).map((version) => {
                        const data = preview.fileVersions[file.path]![version]
                        return (
                          <div key={version}>
                            <strong>
                              {t(
                                version === 'before'
                                  ? 'Original version'
                                  : version === 'local'
                                    ? 'Your version'
                                    : 'Source version',
                              )}
                            </strong>
                            {data ? (
                              <>
                                <span> · {data.bytes} B</span>
                                {data.text !== undefined ? (
                                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-caption">
                                    {data.text}
                                  </pre>
                                ) : (
                                  <p>{t('Content preview unavailable.')}</p>
                                )}
                              </>
                            ) : (
                              <p>{t('File not present')}</p>
                            )}
                          </div>
                        )
                      })}
                    </details>
                  )}
                  {file.conflict && (
                    <div className="flex items-center gap-2">
                      <span className="text-warn">{t('Both versions changed')}</span>
                      <Dropdown
                        label={file.path}
                        value={copyDraft.files[file.path] ?? ''}
                        options={[
                          { value: '', label: t('Choose a version'), disabled: true },
                          { value: 'copy', label: t('Keep my version') },
                          { value: 'source', label: t('Use source version') },
                        ]}
                        disabled={readOnly}
                        onChange={(value) =>
                          !access.current &&
                          setCopyDraft({
                            ...copyDraft,
                            files: { ...copyDraft.files, [file.path]: value as 'copy' | 'source' },
                          })
                        }
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </fieldset>
    </Dialog>
  )
}
