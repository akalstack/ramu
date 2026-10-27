import { useEffect, useState } from 'react'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { SYSTEM_LANGUAGE } from '@ramu/shared/voice/settings'
import type { VoiceReadiness } from '@ramu/shared/voice/engine'
import { Dropdown } from '../Menu'
import { t, useLanguage } from '../i18n'
import { useVoiceCapability, useVoiceSettings } from '../voice/useDictation'

const SYSTEM_MICROPHONE = ''

const statusText = (readiness: VoiceReadiness | undefined): string =>
  t(
    {
      ready: 'Ready on this computer',
      unsupported: 'Not available on this computer. Typing and system dictation still work.',
      'language-unsupported': 'Language not supported offline',
      'model-needed': 'Speech model needed',
      'permission-needed': 'Permission is asked when you first dictate',
      'permission-denied': 'Permission is off in system settings',
    }[readiness ?? 'unsupported'],
  )

/**
 * Voice input choices. They belong to this computer's microphone: they are stored on the device and never sent to a
 * host, so there is no host scope here.
 */
export function VoiceSettings() {
  useLanguage()
  const [settings, update] = useVoiceSettings()
  const capability = useVoiceCapability(settings)
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([])
  // Microphones are only listed once the OS has authorized this app; nothing is requested from here.
  useEffect(() => {
    if (capability?.readiness !== 'ready' || !navigator.mediaDevices?.enumerateDevices) return setMicrophones([])
    let current = true
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (!current) return
        setMicrophones(
          devices
            .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
            .map((device, index) => ({
              id: device.deviceId,
              label: device.label || `${t('Microphone')} ${index + 1}`,
            })),
        )
      })
      .catch(() => current && setMicrophones([]))
    return () => {
      current = false
    }
  }, [capability?.readiness])
  const languages = capability?.languages ?? []
  const supported = !!capability && capability.readiness !== 'unsupported'
  return (
    <>
      <SettingsGroupTitle>{t('Voice input')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel
          title={t('Show microphone button')}
          help={t('Dictate into the message box. Recognition runs on this computer; audio is never uploaded or kept.')}
        />
        <Switch
          aria-label={t('Show microphone button')}
          checked={settings.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </SettingsRow>
      {settings.enabled && (
        <>
          <SettingsRow>
            <SettingsLabel title={t('Speech language')} help={statusText(capability?.readiness)} />
            <Dropdown
              label={t('Speech language')}
              value={settings.language}
              disabled={!supported}
              options={[
                { value: SYSTEM_LANGUAGE, label: t('System language') },
                ...languages.map((tag) => ({ value: tag, label: tag })),
              ]}
              onChange={(language) => update({ language })}
            />
          </SettingsRow>
          {microphones.length > 0 && (
            <SettingsRow>
              <SettingsLabel title={t('Microphone')} help={t('System default unless you choose one.')} />
              <Dropdown
                label={t('Microphone')}
                value={settings.inputDeviceId ?? SYSTEM_MICROPHONE}
                options={[
                  { value: SYSTEM_MICROPHONE, label: t('System default') },
                  ...microphones.map((device) => ({ value: device.id, label: device.label })),
                ]}
                onChange={(id) => update({ inputDeviceId: id || undefined })}
              />
            </SettingsRow>
          )}
          {capability?.readiness === 'permission-denied' && (
            <SettingsRow>
              <SettingsLabel
                title={t('Microphone or speech access is off. Turn it on in system settings to dictate.')}
              />
              <Button variant="secondary" size="sm" onClick={() => void window.ramu.voice?.openSettings()}>
                {t('Open settings')}
              </Button>
            </SettingsRow>
          )}
        </>
      )}
    </>
  )
}
