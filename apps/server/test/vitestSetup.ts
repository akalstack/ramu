import { beforeEach } from 'vitest'
import { launchCompatibility } from '../src/providers/launchCompatibility'

// A launch checks the provider's version before it starts. Tests use fake runners and must not spawn the real
// executables installed on a developer's machine, so the shared checker reads no version (Unverified, never blocked).
beforeEach(() => launchCompatibility.useProbe(async () => null))
