import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProjectPlaces } from '../src/identities/places'
import { setFolderEnvironment } from '../src/userEnvironment'

afterEach(() => setFolderEnvironment(() => ({})))

it('reads remotes once even though each Git call looks up the identity, which reads the places', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-places-'))
  try {
    const project = { id: 'p1', root }
    const places = new ProjectPlaces(
      {
        listProjects: () => [project],
        listRepositories: () => [{ root }],
        listTasks: () => [],
        listBindings: () => [],
      } as unknown as ConstructorParameters<typeof ProjectPlaces>[0],
      join(root, 'chats'),
    )
    let lookups = 0
    // What the host does: a Git call's environment comes from the identity of the folder's project.
    setFolderEnvironment(() => {
      lookups++
      places.places()
      return {}
    })
    places.places()
    await places.refresh()
    expect(lookups).toBe(1)
    expect(places.places()[0]).toMatchObject({ id: 'p1', folders: [root, root] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
