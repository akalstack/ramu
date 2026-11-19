import { useEffect, useRef, useState } from 'react'
import { Alert, Linking } from 'react-native'
import { SYSTEM_LANGUAGE } from '@ramu/shared/voice/settings'
import type { VoiceReadiness } from '@ramu/shared/voice/engine'
import { fill, useT } from '../i18n'
import { prepareVoiceModel, useVoiceCapability, useVoiceSettings } from '../runtime/useDictation'
import { space } from '../theme'
import { ChoiceRow, Hint, ToggleRow } from './SettingRows'
import { Card, Divider, Row, SectionLabel, T } from './ui'

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`

/** Device-local dictation choices. Nothing here is sent to a host: the microphone belongs to this phone. */
export function VoiceSettings() {
  const t = useT()
  const [settings, update] = useVoiceSettings()
  const [refresh, setRefresh] = useState(0)
  const capability = useVoiceCapability(settings, refresh)
  const [downloading, setDownloading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const status: Record<VoiceReadiness, string> = {
    ready: t.voiceStatusReady,
    unsupported: t.voiceStatusUnsupported,
    'language-unsupported': t.voiceStatusLanguage,
    'model-needed': t.voiceStatusModel,
    'permission-needed': t.voiceStatusPermission,
    'permission-denied': t.voiceStatusDenied,
  }
  const languages = capability?.languages ?? []
  const download = async () => {
    const controller = new AbortController()
    abort.current = controller
    setDownloading(true)
    try {
      const language = settings.language === SYSTEM_LANGUAGE ? (capability?.resolvedLanguage ?? '') : settings.language
      await prepareVoiceModel(language, controller.signal)
      setRefresh((n) => n + 1)
    } catch {
      if (!controller.signal.aborted) Alert.alert(t.voiceInput, t.dictateFailedModel)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <>
      <SectionLabel>{t.voiceInput}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={t.voiceShowMic}
          help={t.voiceShowMicHelp}
          value={settings.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <Divider inset={space.l} />
        <ChoiceRow
          title={t.voiceLanguage}
          value={settings.language}
          onChange={(value) => update({ language: String(value) })}
          options={[
            { value: SYSTEM_LANGUAGE, label: t.voiceSystemLanguage },
            ...languages.map((tag) => ({ value: tag, label: tag })),
          ]}
        />
        <Divider inset={space.l} />
        <Row style={{ paddingVertical: space.m }} accessibilityLiveRegion="polite">
          <T tone="muted" style={{ flex: 1 }}>
            {capability ? status[capability.readiness] : t.voiceStatusUnsupported}
          </T>
        </Row>
        {capability?.readiness === 'model-needed' ? (
          <>
            <Divider inset={space.l} />
            <Row
              accessibilityRole="button"
              style={{ paddingVertical: space.m }}
              onPress={() => {
                if (downloading) return abort.current?.abort()
                Alert.alert(
                  t.voiceDownloadModel,
                  capability.modelBytes ? fill(t.dictateModelSize, mb(capability.modelBytes)) : t.dictateModelNeeded,
                  [
                    { text: t.dictateDiscard, style: 'cancel' },
                    { text: t.voiceDownloadModel, onPress: () => void download() },
                  ],
                )
              }}
            >
              <T style={{ flex: 1 }}>{downloading ? `${t.voiceDownloadModel}…` : t.voiceDownloadModel}</T>
            </Row>
          </>
        ) : null}
        {capability?.readiness === 'permission-denied' ? (
          <>
            <Divider inset={space.l} />
            <Row
              accessibilityRole="button"
              style={{ paddingVertical: space.m }}
              onPress={() => void Linking.openSettings()}
            >
              <T style={{ flex: 1 }}>{t.dictateOpenSettings}</T>
            </Row>
          </>
        ) : null}
      </Card>
      <Hint>{t.dictatePermissionNeeded}</Hint>
    </>
  )
}
