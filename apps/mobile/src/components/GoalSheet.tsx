import { useState } from 'react'
import { View } from 'react-native'
import { Pause, Play, ShieldCheck, X } from 'lucide-react-native'
import { goalTurnLimit, type ChatGoal } from '@ramu/shared/types'
import { isUserPaused } from '@ramu/shared/chat/goalHold'
import { font, radius, space, useTheme } from '../theme'
import { useSay, useT } from '../i18n'
import { GoalVerifySheet } from './GoalVerifySheet'
import { Button, T } from './ui'
import { ChoiceRow } from './SettingRows'

/** Limits a goal can take instead of Settings', the common ones a person reaches for (the desktop offers the same). */
const LIMIT_CHOICES = [5, 10, 20, 50, 100]

/**
 * A thread's goal in its own sheet: the whole objective to read, where it stands, the command that checks it, and
 * named actions. The row above the message box keeps the one-line form; a sheet has the room to say all of it.
 */
export function GoalSheet({
  goal,
  onToggle,
  onClear,
  onVerify,
  defaultLimit,
  onLimit,
}: {
  goal: ChatGoal
  onToggle?: () => void
  onClear?: () => void
  /** Sets the goal's verification command, or removes it with null; rejects with the host's reason. */
  onVerify?: (command: string | null) => Promise<void>
  /** Settings' limit on automatic turns, which this goal follows until it has its own; null is none. */
  defaultLimit: number | null
  /** Sets how many automatic turns this goal may take: a number, null for none, or `default` for Settings'. */
  onLimit?: (limit: number | null | 'default') => void
}) {
  const say = useSay()
  const t = useT()
  const { c } = useTheme()
  const [verifying, setVerifying] = useState(false)
  // Only a goal the person paused reads as paused; one held by a usage limit continues by itself.
  const paused = isUserPaused(goal)
  const limit = goalTurnLimit(goal, { maxTurns: defaultLimit })
  return (
    <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
      <View style={{ gap: space.s }}>
        <T size={font.caption} tone={paused ? 'muted' : 'accent'} weight="600">
          {[
            paused ? say('Paused') : null,
            limit === null
              ? say('{0} continuation turns · no limit', { 0: goal.turns })
              : say('{0} continuation turns · limit {1}', { 0: goal.turns, 1: limit }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </T>
        <T style={{ lineHeight: 22 }} copyable>
          {goal.objective}
        </T>
      </View>
      {goal.verify ? (
        <View style={{ gap: space.xs }}>
          <T size={font.caption} tone="muted" weight="600">
            {t.verifyCommand}
          </T>
          <View style={{ padding: space.m, borderRadius: radius.m, backgroundColor: c.fill }}>
            <T mono size={font.control} tone="soft" copyable>
              {goal.verify}
            </T>
          </View>
        </View>
      ) : null}
      {onLimit ? (
        // This goal only: Settings keep the limit every other goal starts with.
        <ChoiceRow
          title={say('Turn limit for this goal')}
          value={goal.maxTurns === undefined ? 'default' : goal.maxTurns === null ? 'none' : String(goal.maxTurns)}
          options={[
            {
              value: 'default',
              label:
                defaultLimit === null
                  ? say('Settings default (no limit)')
                  : say('Settings default ({0})', { 0: defaultLimit }),
            },
            ...[...new Set([...LIMIT_CHOICES, ...(goal.maxTurns ? [goal.maxTurns] : [])])]
              .sort((a, b) => a - b)
              .map((n) => ({ value: String(n), label: say('Limit {0}', { 0: n }) })),
            { value: 'none', label: say('No limit') },
          ]}
          onChange={(next) => onLimit(next === 'default' ? 'default' : next === 'none' ? null : Number(next))}
        />
      ) : null}
      <View style={{ gap: space.s }}>
        {onToggle ? (
          <Button
            kind="secondary"
            icon={paused ? Play : Pause}
            title={paused ? say('Resume goal') : say('Pause goal')}
            onPress={onToggle}
          />
        ) : null}
        {onVerify ? (
          <Button
            kind="secondary"
            icon={ShieldCheck}
            title={goal.verify ? t.verifyEdit : t.verifySet}
            onPress={() => setVerifying(true)}
          />
        ) : null}
        {onClear ? <Button kind="danger" icon={X} title={say('Clear goal')} onPress={onClear} /> : null}
      </View>
      {onVerify ? (
        <GoalVerifySheet open={verifying} goal={goal} onClose={() => setVerifying(false)} onSave={onVerify} />
      ) : null}
    </View>
  )
}
