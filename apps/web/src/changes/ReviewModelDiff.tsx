import type { ChangeFile } from '@ramu/shared/types'
import { ModelViewer } from '../interactive/ModelViewer'
import { t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'

/**
 * A changed glTF model before and after, side by side in the host's 3D viewer, as GitHub compares 3D files. An added or
 * deleted model shows its one side.
 */
export function ReviewModelDiff({ reviewId, file }: { reviewId: string; file: ChangeFile }) {
  useLanguage()
  const { invoke } = useHost()
  const sides = (['old', 'new'] as const).filter((side) =>
    side === 'old' ? file.status !== 'added' : file.status !== 'deleted',
  )
  const name = file.path.split('/').at(-1) ?? file.path
  return (
    <div className={`grid gap-3 p-3 ${sides.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {sides.map((side) => (
        <figure key={side} className="m-0 flex min-w-0 flex-col gap-2">
          <figcaption className={`text-caption font-medium ${side === 'old' ? 'text-bad' : 'text-ok'}`}>
            {side === 'old'
              ? sides.length === 2
                ? t('Before')
                : t('Deleted')
              : sides.length === 2
                ? t('After')
                : t('Added')}
          </figcaption>
          <ModelViewer
            source={`${reviewId}:${file.id}:${side}`}
            title={name}
            load={async (labels) => {
              const html = await invoke('reviews.modelViewer', reviewId, file.id, side, labels)
              if (html === null) throw new Error(t('This run kept no copy of this model.'))
              return html
            }}
          />
        </figure>
      ))}
    </div>
  )
}
