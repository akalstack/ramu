// Gets a nearby device's pairing request in front of the person at the host, wherever they are: the open desktop app
// shows it (in the window, or as a system notification), a closed desktop app is opened just to notify, and a headless
// service prints it with the command that answers it.
import { spawn } from 'node:child_process'
import type { PairingRequestView } from './pairingRequests'
import { userEnvironment } from '../userEnvironment'

export interface PairingNoticeOptions {
  /** Pushes the current requests to the desktop apps on this host's local socket. */
  push: (requests: PairingRequestView[]) => void
  /** Whether a desktop app is connected over the local socket now. */
  desktopConnected: () => boolean
  /** The installed desktop app, when this service shipped inside it. */
  desktopApp?: string
  log?: (line: string) => void
  open?: (executable: string) => void
}

function openDesktop(executable: string) {
  const child = spawn(executable, ['--pairing-request'], { detached: true, stdio: 'ignore', env: userEnvironment() })
  child.on('error', () => {})
  child.unref()
}

export function createPairingNotice(options: PairingNoticeOptions) {
  const announced = new Set<string>()
  return (requests: PairingRequestView[]) => {
    options.push(requests)
    const fresh = requests.filter((request) => !announced.has(request.id))
    for (const id of announced) if (!requests.some((request) => request.id === id)) announced.delete(id)
    if (!fresh.length) return
    for (const request of fresh) {
      announced.add(request.id)
      ;(options.log ?? console.log)(
        `Pairing request from ${request.name || 'a device'} (${request.address}), code ${request.code}. ` +
          `Allow it with \`ramu pair --approve ${request.id}\` or decline with \`ramu pair --deny ${request.id}\`.`,
      )
    }
    if (!options.desktopConnected() && options.desktopApp) (options.open ?? openDesktop)(options.desktopApp)
  }
}
