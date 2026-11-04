// Moves the pointer for a person controlling this Mac from Ramu, as fast as they move it. Each stdin line is
// `x y` in screen points; nothing is written back. A process that stays up costs nothing per move, where starting a
// script each time would lag behind the hand. Clicks, keys and scrolls still go through Ramu's scripted input.
import CoreGraphics
import Foundation

while let line = readLine() {
  let parts = line.split(separator: " ")
  guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]), x.isFinite, y.isFinite else { continue }
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
    .post(tap: .cghidEventTap)
}
exit(0)
