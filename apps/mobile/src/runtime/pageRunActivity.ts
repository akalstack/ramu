import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { ArtifactRun } from '@ramu/shared/artifacts'
import type { PageRunActivityProps } from '../activities/PageRunActivity'

type Instance = {
  update(props: object): Promise<void>
  end(policy: unknown, props?: object): Promise<void>
}

/**
 * Shows a page run that keeps working past a few seconds as a Live Activity on iOS, so it can be followed from the
 * Lock Screen; it ends when the run does. Elsewhere it does nothing.
 */
export function pageRunActivity(page: string, locale: string) {
  const available =
    Platform.OS === 'ios' && Number(Platform.Version) >= 16.2 && !!requireOptionalNativeModule('ExpoWidgets')
  let instance: Instance | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: ArtifactRun | null = null
  const props = (run: ArtifactRun): PageRunActivityProps => ({
    page,
    run: run.name ?? run.task.slice(0, 60),
    step: run.steps.at(-1)?.text ?? '',
    startedAt: run.startedAt,
    phase:
      run.status === 'running'
        ? 'running'
        : run.status === 'done'
          ? 'done'
          : run.status === 'failed'
            ? 'failed'
            : 'stopped',
    locale: locale === 'id' ? 'id' : 'en',
  })
  return {
    page,
    update(run: ArtifactRun) {
      if (!available) return
      last = run
      if (run.status !== 'running') {
        clearTimeout(timer)
        const ending = instance
        instance = null
        void ending?.end('default', props(run)).catch(() => {})
        return
      }
      if (instance) return void instance.update(props(run)).catch(() => {})
      // Short runs finish before anyone would look at the Lock Screen.
      timer ??= setTimeout(() => {
        void import('../activities/PageRunActivity').then(({ PageRunActivityFactory }) => {
          if (last?.status === 'running') instance = PageRunActivityFactory.start(props(last)) as unknown as Instance
        })
      }, 8_000)
    },
    stop() {
      last = null
      clearTimeout(timer)
      void instance?.end('immediate').catch(() => {})
      instance = null
    },
  }
}
