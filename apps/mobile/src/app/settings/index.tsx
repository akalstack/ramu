import { useState } from 'react'
import { translate } from '@ramu/shared/i18n'
import { Platform, TextInput, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Archive, ChevronRight, Search } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../theme'
import { useStore } from '../../runtime/store'
import {
  HOST_ONLY_LABELS,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  searchSettings,
  sectionLabel,
  type SearchHit,
  type SettingsSection,
} from '../../runtime/settingsModel'
import { useHostSettings } from '../../runtime/useHostSettings'
import { useT } from '../../i18n'
import { Screen, useScrolledUnderBar, PageScrollView as ScrollView } from '../../components/Screen'
import { Card, Divider, Row, SectionLabel, T } from '../../components/ui'
import { SectionIcon, SettingsHeader } from '../../components/SettingsChrome'

export default function SettingsMenu() {
  const edge = useScrolledUnderBar()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { language, selected } = useStore()
  const host = useHostSettings(selected)
  const [query, setQuery] = useState('')
  const q = query.trim()
  const results = q
    ? searchSettings(q, host.state.status === 'ready' ? host.state.settings : null, (text) => translate(language, text))
    : []
  const open = (section: SettingsSection, target?: string) =>
    router.push({ pathname: '/settings/[section]', params: target ? { section, target } : { section } })
  const choose = (hit: SearchHit) =>
    'view' in hit ? router.dismissTo({ pathname: '/', params: { filter: 'archived' } }) : open(hit.section, hit.title)
  return (
    <Screen bg="window">
      <SettingsHeader host modal align="center" title={t.settings} scrollEdge scrolled={edge.scrolled} />
      {Platform.OS !== 'web' ? (
        <Stack.SearchBar
          headerIconColor={c.text}
          placeholder={translate(language, 'Search settings')}
          autoCapitalize="none"
          hideWhenScrolling={false}
          textColor={c.text}
          hintTextColor={c.muted}
          tintColor={c.accent}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery('')}
          onClose={() => setQuery('')}
        />
      ) : null}
      {Platform.OS === 'ios' ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.SearchBarSlot />
        </Stack.Toolbar>
      ) : null}
      {Platform.OS === 'web' ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            margin: space.l,
            paddingHorizontal: space.l,
            height: 48,
            borderRadius: radius.full,
            backgroundColor: c.raised,
          }}
        >
          <Search size={18} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={translate(language, 'Search settings')}
            placeholderTextColor={c.placeholder}
            accessibilityLabel={translate(language, 'Search settings')}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: c.text, fontSize: font.body }}
          />
        </View>
      ) : null}
      <ScrollView
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: space.xl * 2, gap: space.m }}
      >
        {q ? (
          <Card
            style={{
              marginHorizontal: space.l,
            }}
          >
            {results.length ? (
              results.map((hit, index) => (
                <View key={'view' in hit ? `view:${hit.view}` : `${hit.section}:${hit.title}`}>
                  {index ? <Divider inset={60} /> : null}
                  <Row onPress={() => choose(hit)} style={{ paddingVertical: space.m }}>
                    {'view' in hit ? <SectionIcon icon={Archive} /> : <SectionIcon section={hit.section} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <T>{translate(language, hit.title)}</T>
                      <T size={font.caption} tone="muted">
                        {translate(language, 'view' in hit ? 'Threads' : sectionLabel(hit.section))}
                      </T>
                    </View>
                    <ChevronRight size={16} color={c.muted} />
                  </Row>
                </View>
              ))
            ) : (
              <T tone="muted" style={{ padding: space.l }}>
                {translate(language, 'No settings match “{query}”.', { query: q })}
              </T>
            )}
          </Card>
        ) : (
          <>
            {SETTINGS_GROUPS.map((group) => (
              <View key={group.id}>
                <SectionLabel>{translate(language, group.label)}</SectionLabel>
                <Card
                  style={{
                    marginHorizontal: space.l,
                  }}
                >
                  {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section, index) => (
                    <View key={section.id}>
                      {index ? <Divider inset={60} /> : null}
                      <Row onPress={() => open(section.id)}>
                        <SectionIcon section={section.id} />
                        <T style={{ flex: 1 }}>{translate(language, section.label)}</T>
                        <ChevronRight size={16} color={c.muted} />
                      </Row>
                    </View>
                  ))}
                </Card>
              </View>
            ))}
            <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.xl }}>
              {translate(language, '{0} are set in Ramu on the host.', {
                0: HOST_ONLY_LABELS.map((label) => translate(language, label)).join(', '),
              })}
            </T>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
