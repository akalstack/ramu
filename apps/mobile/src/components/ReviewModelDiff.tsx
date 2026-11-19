import { useState } from 'react'
import { View } from 'react-native'
import type { ChangeFile } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { HostModelFrame } from './ModelViewer'
import { Segmented, T } from './ui'

type Side = 'old' | 'new'

/**
 * A changed glTF model in the host's 3D viewer. Two viewers side by side would be too small on a phone, so Before and
 * After take turns; an added or deleted model shows its one side.
 */
export function ReviewModelDiff({
  computerId,
  reviewId,
  file,
}: {
  computerId: string
  reviewId: string
  file: ChangeFile
}) {
  const say = useSay()
  const store = useStore()
  const both = file.status === 'modified'
  const [side, setSide] = useState<Side>(file.status === 'deleted' ? 'old' : 'new')
  return (
    <View style={{ padding: space.m, gap: space.s }}>
      {both ? (
        <Segmented
          small
          value={side}
          onChange={setSide}
          options={[
            { key: 'old', label: say('Before') },
            { key: 'new', label: say('After') },
          ]}
        />
      ) : (
        <T size={font.caption} weight="600" tone={side === 'old' ? 'bad' : 'ok'}>
          {side === 'old' ? say('Deleted') : say('Added')}
        </T>
      )}
      <HostModelFrame
        key={side}
        instance={`review-model:${reviewId}:${file.id}:${side}`}
        title={file.path.split('/').at(-1) ?? file.path}
        load={(labels) => store.invoke(computerId, 'reviews.modelViewer', reviewId, file.id, side, labels)}
      />
    </View>
  )
}
