import { useEffect, useRef, useState } from 'react'
import { Platform, ScrollView, TextInput, View, useWindowDimensions, type ScrollViewInstance } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Monitor, SquareTerminal, TextSelect } from 'lucide-react-native'
import { terminalBlockSummary, type TerminalCopyChoices } from '../runtime/terminalCopy'
import { showError, showToast } from '../runtime/toast'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { SheetGroup, SheetOption } from './SheetOptions'
import { Button, Sheet } from './ui'

/**
 * Copying from the phone's terminal, where a finger cannot drag a selection over the terminal itself: a command with
 * its output in one tap, the screen, or recent output opened as text to select a part with the system's own handles.
 */
export function TerminalCopySheet({ choices, onClose }: { choices: TerminalCopyChoices | null; onClose(): void }) {
  const say = useSay()
  const { c } = useTheme()
  const [picking, setPicking] = useState(false)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const scroll = useRef<ScrollViewInstance>(null)
  const { height } = useWindowDimensions()
  useEffect(() => {
    if (!choices) setPicking(false)
    setRange({ start: 0, end: 0 })
  }, [choices])
  const copy = (text: string) => {
    onClose()
    Clipboard.setStringAsync(text).then(
      () => showToast(say('Copied')),
      (error: unknown) => showError(error instanceof Error ? error.message : String(error)),
    )
  }
  const recent = choices?.recent ?? ''
  const picked = recent.slice(range.start, range.end)
  return (
    <Sheet open={!!choices} onClose={onClose} title={picking ? say('Select text') : say('Copy from terminal')}>
      {choices && picking ? (
        <View style={{ gap: space.m, paddingHorizontal: space.l, paddingBottom: space.l }}>
          <ScrollView
            ref={scroll}
            nestedScrollEnabled
            style={{ height: Math.round(height * 0.5), backgroundColor: c.fill, borderRadius: radius.m }}
            contentContainerStyle={{ padding: space.m }}
            // Recent output is read from the bottom, where the newest lines are.
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            <TextInput
              multiline
              scrollEnabled={false}
              value={recent}
              // The text is only for selecting: no keyboard, and typing cannot change it.
              showSoftInputOnFocus={false}
              onChangeText={() => {}}
              onSelectionChange={(event) => setRange(event.nativeEvent.selection)}
              selectionColor={c.accent}
              accessibilityLabel={say('Recent terminal output')}
              style={{
                color: c.text,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                fontSize: font.caption,
                padding: 0,
                textAlignVertical: 'top',
              }}
            />
          </ScrollView>
          <Button title={picked ? say('Copy selection') : say('Copy all')} onPress={() => copy(picked || recent)} />
        </View>
      ) : choices ? (
        <>
          {choices.selection.trim() ? (
            <SheetGroup>
              <SheetOption
                icon={TextSelect}
                title={say('Selected text')}
                help={choices.selection.trim().split('\n')[0]}
                onPress={() => copy(choices.selection)}
              />
            </SheetGroup>
          ) : null}
          <SheetGroup title={say('Command and output')}>
            {choices.blocks.length ? (
              choices.blocks.map((block, index) => {
                const summary = terminalBlockSummary(block)
                return (
                  <SheetOption
                    key={index}
                    icon={SquareTerminal}
                    title={summary.command}
                    help={summary.output ?? say('No output')}
                    onPress={() => copy(block)}
                  />
                )
              })
            ) : (
              <SheetOption
                icon={SquareTerminal}
                title={say('No commands yet')}
                help={say('Commands you run in this terminal show up here, to copy with their output.')}
                disabled
              />
            )}
          </SheetGroup>
          <SheetGroup>
            <SheetOption
              icon={Monitor}
              title={say('Screen')}
              help={say('The rows on screen now')}
              disabled={!choices.screen.trim()}
              onPress={() => copy(choices.screen)}
            />
            <SheetOption
              icon={TextSelect}
              title={say('Select text')}
              help={say('Pick part of the recent output')}
              disabled={!recent.trim()}
              onPress={() => setPicking(true)}
            />
          </SheetGroup>
        </>
      ) : null}
    </Sheet>
  )
}
