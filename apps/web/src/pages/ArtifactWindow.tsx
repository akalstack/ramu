import { useCallback } from 'react'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { AppSettingsProvider } from '../settings/AppSettings'
import { ActiveHostSettings } from '../settings/hostPreferences'
import { ModelSetsProvider } from '../models/ModelSets'
import { BootScreen } from '../Brand'
import { HostStore, WorkspaceProvider } from '../workspace/workspace'
import { ramu } from '../ipc'
import { PageView } from './PageView'

/**
 * An artifact in a window of its own, opened from its installed app or its menu: the same view the Artifacts page
 * shows, with the host's store below it so it reads, runs and edits as there. A thread it starts opens in Ramu's main
 * window, where threads are.
 */
export function ArtifactWindowView({ hostId, artifactId }: { hostId: string; artifactId: string }) {
  const navigate = useCallback(
    (destination: HostDestination) => {
      if (destination.kind === 'task') void ramu.invoke('live.open', hostId, destination.taskId).catch(() => {})
    },
    [hostId],
  )
  return (
    <AppSettingsProvider>
      <WorkspaceProvider activeHost={hostId}>
        {(loaded) =>
          loaded ? (
            <ActiveHostSettings>
              <ModelSetsProvider>
                <HostStore host={hostId} navigate={navigate} fallback={<BootScreen />}>
                  <main className="flex h-screen w-screen bg-background text-foreground">
                    <PageView artifactId={artifactId} inWindow onBack={() => window.close()} />
                  </main>
                </HostStore>
              </ModelSetsProvider>
            </ActiveHostSettings>
          ) : (
            <BootScreen />
          )
        }
      </WorkspaceProvider>
    </AppSettingsProvider>
  )
}
