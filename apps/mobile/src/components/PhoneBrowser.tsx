import { Linking, View } from 'react-native'
import { ExternalLink } from 'lucide-react-native'
import { translate } from '@ramu/shared/i18n'
import { useStore } from '../runtime/store'
import { space } from '../theme'
import { Button, T } from './ui'
import { ViewerHeader } from './ViewerChrome'

export interface PhoneBrowserProps {
  url: string
  /** The page was on the host's localhost and now points at the host's address, so a refused load needs explaining. */
  rewritten: boolean
  /** Where typed words are searched, as in the host browser's address field. */
  searchTemplate: string
  onClose(): void
  /** Moves the page into the host browser, as the person's own tab there, for example to hand it to the agent. */
  onOpenOnHost?(url: string): void
}

/** The web companion has no embedded browser; the page opens in a browser tab instead. */
export default function PhoneBrowser({ url, onClose }: PhoneBrowserProps) {
  const { language } = useStore()
  const t = (text: string) => translate(language, text)
  return (
    <View style={{ flex: 1 }}>
      <ViewerHeader
        title={t('On this phone')}
        subtitle={url}
        closeLabel={t('Back to the host browser')}
        onClose={onClose}
      />
      <View style={{ padding: space.l, gap: space.m }}>
        <T tone="muted">{t('Open this page in the mobile app to load it on this device.')}</T>
        <Button
          title={t('Open in browser')}
          icon={ExternalLink}
          kind="secondary"
          onPress={() => void Linking.openURL(url)}
        />
      </View>
    </View>
  )
}
