import { useEffect, useRef, useState } from 'react'
import { Alert, Share, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Check } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import {
  DEFAULT_THEME,
  THEME_FILE_EXTENSION,
  checkTheme,
  exportThemeFile,
  importThemeFile,
  themeDigest,
  type RamuTheme,
} from '@ramu/shared/theme'
import { useStore } from '../runtime/store'
import { font, radius, space, useTheme } from '../theme'
import { Button, Card, Divider, Row, SectionLabel, Sheet, T } from './ui'
import { Hint } from './SettingRows'

const SWATCHES = ['window', 'canvas', 'raised', 'primary', 'accent', 'ok', 'warn', 'bad'] as const

function Swatches({ theme, scheme }: { theme: RamuTheme; scheme: 'light' | 'dark' }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no">
      {SWATCHES.map((role) => (
        <View
          key={role}
          style={{
            width: 14,
            height: 14,
            borderRadius: radius.xs,
            backgroundColor: theme[scheme].colors[role],
            borderWidth: 1,
            borderColor: c.lineStrong,
          }}
        />
      ))}
    </View>
  )
}

/**
 * The phone's kept themes: pick one, import a shared `.ramu-theme.json`, share one, remove one. An imported theme is shown
 * as a trial with an always-visible Keep / Revert bar, and a trial never outlives this screen. Selecting a theme here is
 * local to this phone and never changes another device.
 */
export function ThemeLibrary() {
  const { language } = useStore()
  const { theme, themes, trial, scheme, tryTheme, keepTheme, selectTheme, removeTheme, c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(language, key, values)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const revert = useRef(tryTheme)
  revert.current = tryTheme
  // Leaving this screen reverts a trial, so a bad palette can never strand the person elsewhere in the app.
  useEffect(() => () => revert.current(null), [])

  const open = async (text: string) => {
    setBusy(true)
    setNotice('')
    try {
      const result = await importThemeFile(text)
      if (!result.ok) return setNotice(t(result.error))
      const same = themes.find((saved) => saved.id === result.theme.id)
      if (same && (await themeDigest(same)) === result.digest) {
        selectTheme(same.id)
        setImporting(false)
        return
      }
      // A changed copy of an installed id becomes its own theme; it never overwrites the original.
      tryTheme(same ? { ...result.theme, id: `${result.theme.id}-${Date.now().toString(36)}` } : result.theme)
      setImporting(false)
      setNotice(
        result.edited
          ? t('The colors in this file were changed after it was exported.')
          : result.issues.length
            ? t('Some colors are hard to read, so this theme cannot be kept.')
            : '',
      )
    } finally {
      setBusy(false)
    }
  }
  const fromClipboard = async () => open(await Clipboard.getStringAsync())
  const fromFile = async () => {
    try {
      const { getDocumentAsync } = await import('expo-document-picker')
      const result = await getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
      if (result.canceled) return
      const { File } = await import('expo-file-system')
      await open(await new File(result.assets[0]!.uri).text())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }
  const share = async (item: RamuTheme) => {
    try {
      await Share.share({ message: await exportThemeFile(item), title: `${item.name}${THEME_FILE_EXTENSION}` })
    } catch (error) {
      Alert.alert(t('Share theme'), error instanceof Error ? error.message : String(error))
    }
  }
  const issues = trial ? checkTheme(trial) : []
  const rows = [DEFAULT_THEME, ...themes]
  return (
    <>
      <SectionLabel>{t('Themes')}</SectionLabel>
      {trial ? (
        <Card style={{ marginHorizontal: space.l, marginBottom: space.m }}>
          <View style={{ padding: space.m, gap: space.s }}>
            <T accessibilityLiveRegion="polite" weight="600">
              {t('Trying {0}. It reverts on its own if you leave or do nothing.', { '0': trial.name })}
            </T>
            <Swatches theme={trial} scheme={scheme} />
            {issues.length ? (
              <T size={font.caption} tone="bad">
                {issues
                  .slice(0, 3)
                  .map((issue) => issue.message)
                  .join(' ')}
              </T>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Button
                title={t('Keep theme')}
                disabled={issues.length > 0}
                onPress={() => {
                  keepTheme(trial)
                  setNotice('')
                }}
              />
              <Button
                kind="ghost"
                title={t('Revert')}
                onPress={() => {
                  tryTheme(null)
                  setNotice('')
                }}
              />
            </View>
          </View>
        </Card>
      ) : null}
      <Card style={{ marginHorizontal: space.l }}>
        {rows.map((item, index) => {
          const selected = !trial && theme.id === item.id
          return (
            <View key={item.id}>
              {index ? <Divider inset={space.l} /> : null}
              <Row
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={item.id === DEFAULT_THEME.id ? t('Ramu Default') : item.name}
                onPress={() => {
                  tryTheme(null)
                  selectTheme(item.id === DEFAULT_THEME.id ? null : item.id)
                }}
                style={{ paddingVertical: space.m }}
              >
                <View style={{ flex: 1, gap: 6 }}>
                  <T weight="500">{item.id === DEFAULT_THEME.id ? t('Ramu Default') : item.name}</T>
                  <Swatches theme={item} scheme={scheme} />
                </View>
                {selected ? <Check size={17} color={c.primary} /> : null}
              </Row>
              {item.id !== DEFAULT_THEME.id ? (
                <View style={{ flexDirection: 'row', paddingHorizontal: space.l, paddingBottom: space.s }}>
                  <Button kind="ghost" title={t('Share theme')} onPress={() => void share(item)} />
                  <Button
                    kind="ghost"
                    title={t('Remove')}
                    onPress={() =>
                      Alert.alert(t('Remove theme'), t('Remove {0}? Other themes are unchanged.', { '0': item.name }), [
                        { text: t('Cancel'), style: 'cancel' },
                        { text: t('Remove'), style: 'destructive', onPress: () => removeTheme(item.id) },
                      ])
                    }
                  />
                </View>
              ) : null}
            </View>
          )
        })}
        <Divider inset={space.l} />
        <Row accessibilityRole="button" onPress={() => setImporting(true)}>
          <T tone="accent">{t('Import theme')}</T>
        </Row>
      </Card>
      {notice ? <Hint>{notice}</Hint> : null}
      <Hint>
        {t(
          'A theme changes colors only, on this phone. Importing shows it first; nothing is applied until you keep it.',
        )}
      </Hint>
      <Sheet open={importing} onClose={() => setImporting(false)} title={t('Import theme')}>
        <View style={{ padding: space.l, gap: space.s }}>
          <T tone="muted" size={font.caption}>
            {t('Open a .ramu-theme.json file or paste its text.')}
          </T>
          <Button title={t('Choose a file')} disabled={busy} onPress={() => void fromFile()} />
          <Button
            kind="secondary"
            title={t('Paste from clipboard')}
            disabled={busy}
            onPress={() => void fromClipboard()}
          />
          {notice ? <T tone="bad">{notice}</T> : null}
        </View>
      </Sheet>
    </>
  )
}
