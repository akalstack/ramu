export const CREDENTIAL_NOT_SAVED =
  'The host accepted this code, but this phone could not store the credential it issued. On the host, remove this phone under Devices (an unused one is removed after a week), then pair again with a new code.'

/**
 * Stores a credential the host has just issued, trying again briefly: a keychain that is momentarily busy or locked
 * should not cost the person a spent pairing code. When it still cannot be stored the error says exactly what was left
 * behind on the host, so the person can clear it and pair again instead of wondering whether anything happened.
 */
export async function saveIssuedCredential(
  save: () => Promise<void>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await save()
      return
    } catch {
      if (attempt >= attempts) throw new Error(CREDENTIAL_NOT_SAVED)
      await wait(300 * attempt)
    }
  }
}
