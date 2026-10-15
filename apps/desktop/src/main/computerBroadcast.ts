import type { Computers } from '@ramu/shared/types'

/** One snapshot per burst, sent only to the workspace on screen. Hidden workspaces catch up when shown. */
export class ComputerBroadcaster {
  private timer: NodeJS.Timeout | undefined
  constructor(
    private readonly snapshot: () => Computers,
    private readonly send: (state: Computers) => void,
  ) {}
  changed() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.send(this.snapshot())
    }, 50)
  }
  flush() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.send(this.snapshot())
  }
  close() {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
