import { useRouter } from 'expo-router'
import { Monitor } from 'lucide-react-native'
import { View } from 'react-native'
import NewChat from '../../new'
import { useStore } from '../../../runtime/store'
import { useT } from '../../../i18n'
import { Header, Screen } from '../../../components/Screen'
import { Nothing } from '../../../components/InboxParts'
import { Button } from '../../../components/ui'
import { space } from '../../../theme'

export default function NewThreadTab() {
  const store = useStore()
  const t = useT()
  const router = useRouter()
  const host = store.computers.find((host) => host.id === store.selected)
  if (host && host.status !== 'revoked') return <NewChat key={host.id} asTab />
  return (
    <Screen>
      <Header title={t.newChat} back={false} />
      <View style={{ flex: 1, justifyContent: 'center', padding: space.l, gap: space.l }}>
        <Nothing
          icon={Monitor}
          title={host ? t.revokedTitle : t.noComputer}
          detail={host ? t.revokedHint : t.noComputerHint}
        />
        <Button title={t.pair} onPress={() => router.push(host ? '/pair' : '/welcome')} />
      </View>
    </Screen>
  )
}
