import type {
  ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'
import type { OcuBackend } from './ocu'

/** Apps go to the app-scoped backend; the whole display goes to the display backend. */
export class ComputerRouter implements ComputerBackend {
  constructor(
    private readonly display: ComputerBackend,
    private readonly apps: Pick<OcuBackend, 'status' | 'capture' | 'perform' | 'releaseInput' | 'apps'> &
      ComputerBackend,
  ) {}

  private pick(target: ComputerTarget): ComputerBackend {
    return target.kind === 'app' ? this.apps : this.display
  }

  status(): ComputerRuntimeStatus {
    const display = this.display.status()
    return display.available ? display : this.apps.status()
  }

  /** What an app grant can use: the display runtime's status is separate from whether app control is installed. */
  appStatus(): ComputerRuntimeStatus {
    return this.apps.status()
  }

  listApps(): Promise<string[]> {
    return this.apps.apps()
  }

  warm(): void {
    this.display.warm?.()
  }

  frameInterval(target: ComputerTarget): number {
    return this.pick(target).frameInterval?.(target) ?? 250
  }

  capture(target: ComputerTarget): Promise<ComputerCapture> {
    return this.pick(target).capture(target)
  }

  perform(target: ComputerTarget, action: ComputerAction): Promise<void> {
    return this.pick(target).perform(target, action)
  }

  releaseInput(target: ComputerTarget): void {
    this.pick(target).releaseInput(target)
  }
}
