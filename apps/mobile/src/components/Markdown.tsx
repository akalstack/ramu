import { ScrollView, Text, View } from 'react-native'
import { font, radius, space, useTheme } from '../theme'

// Native markdown for agent replies: paragraphs, fenced code, **bold** and `code`.
// Kept native: shared's react-markdown renderer depends on the DOM.

function Inline({ text }: { text: string }) {
  const { c } = useTheme()
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return (
    <Text style={{ color: c.body, fontSize: font.body, lineHeight: 22 }}>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <Text key={i} style={{ fontWeight: '600', color: c.text }}>
            {p.slice(2, -2)}
          </Text>
        ) : p.startsWith('`') ? (
          <Text key={i} style={{ fontFamily: font.mono, fontSize: font.control, color: c.soft, backgroundColor: c.fill }}>
            {` ${p.slice(1, -1)} `}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  )
}

export function Markdown({ text }: { text: string }) {
  const { c } = useTheme()
  const blocks = text.split(/(```[\s\S]*?```)/g).filter((b) => b.trim())
  return (
    <View style={{ gap: space.m }}>
      {blocks.flatMap((block, i) => {
        if (block.startsWith('```')) {
          const body = block.replace(/^```\w*\n?/, '').replace(/```$/, '').trimEnd()
          return [
            <ScrollView key={i} horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: c.code, borderRadius: radius.s }} contentContainerStyle={{ padding: space.m }}>
              <Text style={{ fontFamily: font.mono, fontSize: font.caption + 0.5, lineHeight: 18, color: c.soft }}>{body}</Text>
            </ScrollView>,
          ]
        }
        return block
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((p, j) => <Inline key={`${i}-${j}`} text={p.trim()} />)
      })}
    </View>
  )
}
