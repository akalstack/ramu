// The system Paste in the message box, through the Ramu-owned `RamuPaste` native module: a copied picture or file is
// handed over as a file in the app's temporary folder, while text still pastes as text. iOS offers Paste for whatever
// field is being edited, so only a focused composer takes it; Android watches the one field it is told about.
import { useEffect, useRef, type RefObject } from 'react'
import { findNodeHandle, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'

/** A pasted item; `uri` is empty when it was larger than an attachment may be, so only its name and size are known. */
export interface PastedFile {
  uri: string
  name: string
  mimeType: string
  size: number
}

interface RamuPasteNative {
  watch?(tag: number): Promise<boolean>
  addListener(event: 'onPaste', listener: (event: { files?: PastedFile[] }) => void): { remove(): void }
}

const nativeModule = (): RamuPasteNative | null =>
  Platform.OS === 'web' ? null : requireOptionalNativeModule<RamuPasteNative>('RamuPaste')

/** Keeps only well-formed items; the payload crosses the native boundary, so nothing about it is assumed. */
export function pastedFiles(event: { files?: unknown } | null | undefined): PastedFile[] {
  if (!Array.isArray(event?.files)) return []
  return event.files
    .filter(
      (file): file is PastedFile =>
        !!file &&
        typeof file.uri === 'string' &&
        typeof file.name === 'string' &&
        file.name.length > 0 &&
        typeof file.mimeType === 'string' &&
        typeof file.size === 'number',
    )
    .slice(0, 10)
}

/** Hands what is pasted into `input` to `onFiles` while `input` is the field being edited. */
export function usePastedFiles(
  input: RefObject<{ isFocused(): boolean } | null>,
  onFiles: (files: PastedFile[]) => void,
) {
  const handler = useRef(onFiles)
  handler.current = onFiles
  useEffect(() => {
    const native = nativeModule()
    if (!native) return
    if (Platform.OS === 'android' && native.watch) {
      // findNodeHandle reads the mounted field's tag; the field is mounted by the time effects run.
      const tag = input.current ? findNodeHandle(input.current as never) : null
      if (typeof tag === 'number') void native.watch(tag).catch(() => {})
    }
    const subscription = native.addListener('onPaste', (event) => {
      if (!input.current?.isFocused()) return
      const files = pastedFiles(event)
      if (files.length) handler.current(files)
    })
    return () => subscription.remove()
  }, [input])
}
