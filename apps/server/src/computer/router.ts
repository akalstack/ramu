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
      ComputerBackend & { close?(): Promise<void> },
  ) {}

  private pick(target: ComputerTarget): ComputerBackend {
    return target.kind === 'app' ? this.apps : this.display
  }

  status(): ComputerRuntimeStatus {
    const display = this.display.status()
    // A locked screen is the reason to show, not the app backend's separate state.
    if (display.available || display.reason === 'locked') return display
    return this.apps.status()
  }

  useScale(scale: number): void {
    this.display.useScale?.(scale)
  }

  /** The display backend reads the lock; an app backend acts behind it, but no screen video can see it. */
  locked(): Promise<boolean> {
    return this.display.locked?.() ?? Promise.resolve(false)
  }

  /** What an app grant can use: the display runtime's status is separate from whether app control is installed. */
  appStatus(): ComputerRuntimeStatus {
    return this.apps.status()
  }

  async closeApps(): Promise<void> {
    await this.apps.close?.()
  }

  listApps(): Promise<string[]> {
    return this.apps.apps()
  }

  /** Only the display backend moves the real pointer, so only it can conflict with the person's own input. */
  localInputActive(target: ComputerTarget): Promise<boolean> {
    return target.kind === 'display'
      ? (this.display.localInputActive?.(target) ?? Promise.resolve(false))
      : Promise.resolve(false)
  }

  /** Both target kinds run on this computer, so the system's focused element answers for either. */
  focusedField(target: ComputerTarget) {
    return this.display.focusedField?.(target) ?? Promise.resolve({ editable: false })
  }

  warm(): void {
    this.display.warm?.()
  }

  frameInterval(target: ComputerTarget): number {
    return this.pick(target).frameInterval?.(target) ?? 250
  }

  capture(target: ComputerTarget, options?: { forViewer?: boolean }): Promise<ComputerCapture> {
    return this.pick(target).capture(target, options)
  }

  perform(
    target: ComputerTarget,
    action: ComputerAction,
    options?: { byPerson?: boolean },
  ): Promise<ComputerCapture | void> {
    return this.pick(target).perform(target, action, options)
  }

  releaseInput(target: ComputerTarget): void {
    this.pick(target).releaseInput(target)
  }
}
