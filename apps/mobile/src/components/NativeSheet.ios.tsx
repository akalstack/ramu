import { useEffect } from 'react'
import { View, useWindowDimensions } from 'react-native'
import {
  BottomSheet,
  Button,
  Host,
  HStack,
  Image,
  TextField,
  useNativeState,
  NavigationStack,
  RNHostView,
  ScrollView,
  Toolbar,
  ToolbarItem,
} from '@expo/ui/swift-ui'
import {
  background,
  accessibilityLabel,
  autocorrectionDisabled,
  textInputAutocapitalization,
  submitLabel,
  onSubmit,
  frame,
  labelStyle,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  scrollEdgeEffectStyle,
} from '@expo/ui/swift-ui/modifiers'
import { space, useTheme } from '../theme'
import type { NativeSheetProps, SheetSearchProps } from './NativeSheet'
import { useSay } from '../i18n'
import { useHostedWidth } from './hostedWidth'

/** Native presentation, navigation chrome, dismissal and scroll-edge material for every iOS dialog. */
export function NativeSheet({ open, onClose, title, children, scroll = true, presentation, search }: NativeSheetProps) {
  const { c, scheme } = useTheme()
  const width = useHostedWidth()
  const content = (
    <RNHostView matchContents={scroll ? { vertical: true } : false} onLayout={width.onLayout}>
      <View
        style={{
          width: width.value,
          backgroundColor: c.window,
          paddingBottom: space.l,
          ...(scroll ? {} : { flex: 1 }),
        }}
      >
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
              {search ? <NativeSheetSearch search={search} /> : null}
            </Toolbar.Content>
          </Toolbar>
        </NavigationStack>
      </BottomSheet>
    </Host>
  )
}

function NativeSheetSearch({ search }: { search: SheetSearchProps }) {
  const say = useSay()
  const text = useNativeState(search.value)
  const { width } = useWindowDimensions()
  const { c } = useTheme()
  useEffect(() => {
    text.set(search.value)
  }, [text, search.value])
  return (
    <ToolbarItem placement="bottomBar">
      <HStack spacing={8} modifiers={[frame({ width: Math.min(600, Math.max(160, width - 64)) })]}>
        <Image systemName="magnifyingglass" color={c.muted} />
        <TextField
          text={text}
          placeholder={search.placeholder}
          onTextChange={search.onChangeText}
          modifiers={[
            accessibilityLabel(search.label ?? search.placeholder),
            autocorrectionDisabled(),
            textInputAutocapitalization('never'),
            submitLabel('search'),
            frame({ minHeight: 44 }),
            onSubmit(() => search.onSubmit?.()),
          ]}
        />
        {search.value ? (
          <Button
            label={say('Clear search')}
            systemImage="xmark.circle.fill"
            modifiers={[labelStyle('iconOnly')]}
            onPress={() => search.onChangeText('')}
          />
        ) : null}
      </HStack>
    </ToolbarItem>
  )
}
