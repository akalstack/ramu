import { useEffect } from 'react'
import { ramu } from '../ipc'
import { useHostSelection } from './HostSelection'

/**
 * Main-process destinations (including notification clicks) use the same host selection path as a sidebar click.
 */
export function HostNavigation() {
  const { select } = useHostSelection()
  useEffect(() => {
    const off = ramu.on('computers:navigate', ({ hostId, destination }) => select(hostId, destination))
    void ramu.invoke('computers.navigation.ready').catch(() => {})
    return off
  }, [select])
  return null
}
