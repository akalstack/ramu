// Stands in for `isomorphic-webcrypto/src/react-native`, which lib0 (Yjs's helper library) imports on React Native
// but does not install. Yjs only draws random numbers from it, for each copy's client id; nothing here signs or
// encrypts. The system's secure source is used when the build has expo-crypto, and Math.random otherwise, because an
// app built before expo-crypto was added would stop entirely on importing it.
import { requireOptionalNativeModule } from 'expo'

type Filled = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array

function getRandomValues<T extends Filled>(array: T): T {
  if (requireOptionalNativeModule('ExpoCrypto')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only when its native module exists
    const { getRandomValues: secure } = require('expo-crypto') as { getRandomValues: <A extends Filled>(a: A) => A }
    return secure(array)
  }
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
  for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
  return array
}

export default {
  ensureSecure: () => undefined,
  subtle: undefined,
  getRandomValues,
}
