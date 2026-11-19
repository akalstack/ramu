import { Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'
import { EMPTY_PAGE_WIDGET, type PageWidgetProps } from './pageWidgetProps'

/** A page's widget on the iOS home screen, as SwiftUI serialized into the widget extension. */
function PageWidgetLayout(props: PageWidgetProps, environment: WidgetEnvironment) {
  'widget'
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
  const list = props.items.length > 0
  return (
    <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 14 })]}>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), secondary]}>{props.page}</Text>
      <Text modifiers={[font({ size: 13 })]}>{props.title}</Text>
      {list ? (
        <VStack alignment="leading" spacing={2}>
          {props.items.slice(0, environment.widgetFamily === 'systemSmall' ? 3 : 5).map((item, index) => (
            <Text key={index} modifiers={[font({ size: 13 })]}>
              {item}
            </Text>
          ))}
        </VStack>
      ) : (
        <Text modifiers={[font({ size: 30, weight: 'bold', design: 'rounded' })]}>{props.value}</Text>
      )}
      <Spacer />
      {props.updatedAt ? (
        <Text date={new Date(props.updatedAt)} dateStyle="relative" modifiers={[font({ size: 11 }), secondary]} />
      ) : null}
    </VStack>
  )
}

export const PageWidget = createWidget<PageWidgetProps>('RamuPage', PageWidgetLayout, EMPTY_PAGE_WIDGET)
