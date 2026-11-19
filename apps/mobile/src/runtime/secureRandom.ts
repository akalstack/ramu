import { requireOptionalNativeModule } from 'expo'

/**
 * The system's secure random source, or null on a build without it (an app built before expo-crypto was added). Loaded
 * only when its native module exists, because importing it on such a build would stop the whole app.
 */
export async function secureRandom(): Promise<((bytes: number) => Uint8Array) | null> {
  if (!requireOptionalNativeModule('ExpoCrypto')) return null
  const { getRandomBytes } = await import('expo-crypto')
  return (bytes) => getRandomBytes(bytes)
}
