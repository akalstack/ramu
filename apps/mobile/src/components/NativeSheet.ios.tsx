import { View } from 'react-native'
import {
  BottomSheet,
  Button,
  Host,
  NavigationStack,
  RNHostView,
  ScrollView,
  Toolbar,
  ToolbarItem,
} from '@expo/ui/swift-ui'
import {
  background,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollEdgeEffectStyle,
} from '@expo/ui/swift-ui/modifiers'
import { space, useTheme } from '../theme'
import type { NativeSheetProps } from './NativeSheet'
import { BottomSearch } from './BottomSearch'
import { useHostedWidth } from './hostedWidth'

/** Native presentation, navigation chrome, dismissal and scroll-edge material for every iOS dialog. */
export function NativeSheet({ open, onClose, title, children, scroll = true, presentation, search }: NativeSheetProps) {
  const { c, scheme } = useTheme()
  const hosted = useHostedWidth()
  const content = (
    <RNHostView matchContents={scroll ? { vertical: true } : false} onLayout={hosted.onLayout}>
      <View
        style={{
          width: hosted.width,
          backgroundColor: c.window,
          // Content that scrolls itself reaches the sheet's bottom edge, so the line being typed can sit right above the
          // keyboard instead of under a strip of padding.
          ...(scroll ? { paddingBottom: space.l } : { flex: 1 }),
        }}
      >
        {/* Under the title, as in every other search sheet: a bottom-bar field folded into a lone magnifier button
            that floated over the list. */}
        {search ? <BottomSearch {...search} inputOnly /> : null}
        {children}
      </View>
    </RNHostView>
  )
  return (
    <Host colorScheme={scheme} seedColor={c.text} style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose()
        }}
      >
        <NavigationStack
          modifiers={[
            presentationBackground(c.window),
            presentationDetents(presentation === 'screen' || search ? ['large'] : ['medium', 'large']),
            presentationDragIndicator('visible'),
          ]}
        >
          <Toolbar
            modifiers={[navigationTitle(title ?? ''), navigationBarTitleDisplayMode('inline'), background(c.window)]}
          >
            {scroll ? <ScrollView modifiers={[scrollEdgeEffectStyle('soft', 'top')]}>{content}</ScrollView> : content}
            <Toolbar.Content>
              <ToolbarItem placement="cancellationAction">
                <Button role="close" onPress={onClose} />
              </ToolbarItem>
            </Toolbar.Content>
          </Toolbar>
        </NavigationStack>
      </BottomSheet>
    </Host>
  )
}
