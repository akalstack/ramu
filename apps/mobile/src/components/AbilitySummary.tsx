import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { ABILITIES, ABILITY_LABELS, type AbilityCheck, type AbilityChoice } from '@ramu/shared/providers/abilities'
import { providerName } from '@ramu/shared/providers/providers'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Card, Divider, SectionLabel, T } from './ui'

/** Settings › Models on the phone: each ability's choice and the providers that passed their check, read only. */
export function AbilitySummary({ hostId }: { hostId: string }) {
  const store = useStore()
  const say = useSay()
  const [checks, setChecks] = useState<AbilityCheck[] | null>(null)
  const online = store.isOnline(hostId)
  useEffect(() => {
    if (!online) return
    let alive = true
    void store.invoke(hostId, 'abilities.checks').then(
      (status) => alive && setChecks(status.checks),
      () => alive && setChecks([]),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads once per host and connection; the store object changes on every update
  }, [hostId, online])
  const choices = store.appPreferences[hostId]?.abilities?.choices ?? {}
  const describe = (choice: AbilityChoice | undefined) =>
    !choice || choice === 'auto'
      ? say('Auto')
      : choice === 'off'
        ? say('Off')
        : `${choice.model} · ${providerName(choice.provider)}`
  return (
    <>
      <SectionLabel>{say('Abilities')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {ABILITIES.map((ability, index) => {
          const passed = (checks ?? []).filter((check) => check.ability === ability && check.ok)
          return (
            <View key={ability}>
              {index ? <Divider inset={space.l} /> : null}
              <View style={{ padding: space.m, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
                  <T size={font.control} style={{ flexShrink: 1 }}>
                    {say(ABILITY_LABELS[ability])}
                  </T>
                  <T size={font.control} tone="muted">
                    {describe(choices[ability])}
                  </T>
                </View>
                <T size={font.caption} tone="muted">
                  {checks === null
                    ? say('Loading…')
                    : passed.length
                      ? say('Checked on {0}', {
                          '0': [...new Set(passed.map((check) => providerName(check.provider)))].join(', '),
                        })
                      : say('No signed-in provider here offers it.')}
                </T>
              </View>
            </View>
          )
        })}
      </Card>
    </>
  )
}
