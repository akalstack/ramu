import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Minus, Plus } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { WEEKDAYS, parseTime, shiftTime, type Lang } from '../runtime/scheduleModel'
import { T, tap } from './ui'
import { useSay } from '../i18n'

/** A small caption above a form control. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T size={font.caption} weight="600" tone="muted" style={{ letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {label}
      </T>
      {children}
    </View>
  )
}

export function TextField(props: {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  multiline?: boolean
  maxLength?: number
  keyboardType?: 'default' | 'number-pad'
}) {
  const { c } = useTheme()
  return (
    <TextInput
      {...props}
      placeholderTextColor={c.placeholder}
      style={{
        color: c.text,
        fontSize: font.body,
        backgroundColor: c.raised2,
        borderRadius: radius.m,
        paddingHorizontal: space.l,
        paddingVertical: space.m,
        minHeight: props.multiline ? 96 : 46,
        textAlignVertical: props.multiline ? 'top' : 'center',
      }}
    />
  )
}

function StepButton({ icon: I, label, onPress }: { icon: typeof Plus; label: string; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => {
        tap()
        onPress()
      }}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : c.fill,
      })}
    >
      <I size={18} color={c.text} />
    </Pressable>
  )
}

/** A number with minus and plus buttons. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  format?: (value: number) => string
}) {
  const say = useSay()
  const move = (by: number) => onChange(Math.min(max, Math.max(min, value + by)))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <StepButton icon={Minus} label={say('Decrease')} onPress={() => move(-step)} />
      <T weight="600" style={{ minWidth: 40, textAlign: 'center' }}>
        {format ? format(value) : String(value)}
      </T>
      <StepButton icon={Plus} label={say('Increase')} onPress={() => move(step)} />
    </View>
  )
}

/** "09:00" typed or nudged by 15 minutes. Only a valid time is passed on. */
export function TimeField({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const say = useSay()
  const { c } = useTheme()
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => {
    const parsed = parseTime(text)
    if (parsed) onChange(parsed)
    else setText(value)
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <StepButton icon={Minus} label={say('Earlier')} onPress={() => onChange(shiftTime(value, -15))} />
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        returnKeyType="done"
        style={{
          width: 88,
          height: 46,
          textAlign: 'center',
          color: c.text,
          fontSize: font.heading,
          fontWeight: '600',
          backgroundColor: c.raised2,
          borderRadius: radius.m,
        }}
      />
      <StepButton icon={Plus} label={say('Later')} onPress={() => onChange(shiftTime(value, 15))} />
    </View>
  )
}

/** Seven round day buttons, Monday first. */
export function WeekdayPicker({
  value,
  onToggle,
  lang,
}: {
  value: number[]
  onToggle: (day: number) => void
  lang: Lang
}) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {WEEKDAYS.map((w) => {
        const on = value.includes(w.day)
        return (
          <Pressable
            key={w.day}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={w.long[lang]}
            onPress={() => {
              tap()
              onToggle(w.day)
            }}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.accentSoft : c.raised2,
            }}
          >
            <T weight="600" size={font.control} style={{ color: on ? c.accent : c.soft }}>
              {w.short[lang]}
            </T>
          </Pressable>
        )
      })}
    </View>
  )
}
