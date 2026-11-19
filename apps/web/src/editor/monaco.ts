import { monaco } from './monacoCore'
import { nativeMonacoMenu } from './monacoMenu'

// Only workspace editors receive device-native menus; the isolated theme renderer has no host bridge.
monaco.editor.onDidCreateEditor(nativeMonacoMenu)

export { monaco }
