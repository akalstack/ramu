import { Column, Spacer, Text } from '@expo/ui/jetpack-compose'
import { createWidget } from 'expo-widgets'
import { EMPTY_PAGE_WIDGET, type PageWidgetProps } from './pageWidgetProps'

/** A page's widget on the Android home screen, drawn by Glance from Compose primitives. */
function PageWidgetLayout(props: PageWidgetProps) {
  'widget'
  return (
    <Column>
      <Text>{props.page}</Text>
      <Text>{props.title}</Text>
      {props.items.length > 0 ? (
        <Column>
          {props.items.slice(0, 4).map((item, index) => (
            <Text key={index}>{item}</Text>
          ))}
        </Column>
      ) : (
        <Text>{props.value}</Text>
      )}
      <Spacer />
    </Column>
  )
}

export const PageWidget = createWidget<PageWidgetProps>('RamuPage', PageWidgetLayout, EMPTY_PAGE_WIDGET)
