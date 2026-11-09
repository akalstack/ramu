import WidgetKit
import SwiftUI
internal import ExpoWidgets

struct RamuPage: Widget {
  let name: String = "RamuPage"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: name, provider: WidgetsTimelineProvider(name: name)) { entry in
      WidgetsEntryView(entry: entry)
    }
    .configurationDisplayName("Ramu page")
    .description("A number or short list from one of your Ramu pages.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}