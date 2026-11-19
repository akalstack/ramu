// Posts a person's (or an agent's) input to this Mac as it arrives, from one process that stays up: starting a script
// per click or key added a visible delay to every action. Each stdin line is one command, in screen points, and gets
// one reply line, `ok` or `err <reason>`, in order:
//   move x y | click x y button count | scroll x y dx dy | drag fx fy tx ty | key code flags | type <base64 UTF-8>
// button: 0 left, 1 right, 2 middle. Pointer moves are posted as they come; nothing else waits on them.
import Carbon
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func post(_ event: CGEvent?) { event?.post(tap: .cghidEventTap) }

func mouse(_ type: CGEventType, _ x: Double, _ y: Double, _ button: CGMouseButton = .left) -> CGEvent? {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: button)
}

func click(_ x: Double, _ y: Double, button: Int, count: Int) {
  let (down, up, which): (CGEventType, CGEventType, CGMouseButton) =
    button == 1 ? (.rightMouseDown, .rightMouseUp, .right)
    : button == 2 ? (.otherMouseDown, .otherMouseUp, .center) : (.leftMouseDown, .leftMouseUp, .left)
  post(mouse(.mouseMoved, x, y))
  for state in 1...max(1, min(3, count)) {
    for type in [down, up] {
      let event = mouse(type, x, y, which)
      event?.setIntegerValueField(.mouseEventClickState, value: Int64(state))
      post(event)
    }
  }
}

func drag(_ fx: Double, _ fy: Double, _ tx: Double, _ ty: Double) {
  post(mouse(.mouseMoved, fx, fy))
  post(mouse(.leftMouseDown, fx, fy))
  let steps = 8
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    post(mouse(.leftMouseDragged, fx + (tx - fx) * t, fy + (ty - fy) * t))
    usleep(8000)
  }
  post(mouse(.leftMouseUp, tx, ty))
}

func key(_ code: CGKeyCode, flags: UInt64) {
  for down in [true, false] {
    let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
    event?.flags = CGEventFlags(rawValue: flags)
    post(event)
  }
}

/// Which key, with which modifiers, types each character on the current keyboard layout. Secure fields (the lock
/// screen's password, any password box) read the key that was pressed and ignore the attached text, so a character
/// sent on a placeholder key would arrive as that key's letter.
func layoutKeys() -> [Character: (CGKeyCode, CGEventFlags)] {
  guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
    let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
  else { return [:] }
  let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue() as Data
  var keys: [Character: (CGKeyCode, CGEventFlags)] = [:]
  // Plain keys first, so a character reachable without modifiers keeps the plainest way to type it.
  let states: [(UInt32, CGEventFlags)] = [
    (0, []), (UInt32(shiftKey >> 8), .maskShift), (UInt32(optionKey >> 8), .maskAlternate),
    (UInt32((shiftKey | optionKey) >> 8), [.maskShift, .maskAlternate]),
  ]
  data.withUnsafeBytes { raw in
    guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
    for (modifiers, flags) in states {
      for code in 0..<128 {
        var dead: UInt32 = 0
        var length = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let status = UCKeyTranslate(
          layout, UInt16(code), UInt16(kUCKeyActionDown), modifiers, UInt32(LMGetKbdType()),
          OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, chars.count, &length, &chars)
        guard status == noErr, length == 1, let character = String(utf16CodeUnits: chars, count: 1).first,
          keys[character] == nil
        else { continue }
        keys[character] = (CGKeyCode(code), flags)
      }
    }
  }
  return keys
}

/// Each character on the key that types it, with its text attached; one the layout cannot type goes as text alone.
func type(_ text: String) {
  let keys = layoutKeys()
  for character in text {
    let units = Array(String(character).utf16)
    let (code, flags) = keys[character] ?? (0, [])
    let known = keys[character] != nil
    for down in [true, false] {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
      if known { event?.flags = flags }
      units.withUnsafeBufferPointer { buffer in
        event?.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
      }
      post(event)
    }
  }
}

func run(_ line: String) -> String? {
  let parts = line.split(separator: " ").map(String.init)
  guard let command = parts.first else { return "err empty" }
  let n = parts.dropFirst().map { Double($0) }
  func number(_ i: Int) -> Double? { i < n.count ? n[i].flatMap { $0.isFinite ? $0 : nil } : nil }
  switch command {
  case "move":
    guard let x = number(0), let y = number(1) else { return "err move needs x y" }
    post(mouse(.mouseMoved, x, y))
    return nil
  case "click":
    guard let x = number(0), let y = number(1) else { return "err click needs x y" }
    click(x, y, button: Int(number(2) ?? 0), count: Int(number(3) ?? 1))
  case "scroll":
    guard let x = number(0), let y = number(1), let dx = number(2), let dy = number(3) else { return "err scroll needs x y dx dy" }
    post(mouse(.mouseMoved, x, y))
    post(CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(-dy.rounded()), wheel2: Int32(-dx.rounded()), wheel3: 0))
  case "drag":
    guard let fx = number(0), let fy = number(1), let tx = number(2), let ty = number(3) else { return "err drag needs four numbers" }
    drag(fx, fy, tx, ty)
  case "key":
    guard let code = number(0), (0...127).contains(code) else { return "err key needs a key code" }
    key(CGKeyCode(code), flags: UInt64(number(1) ?? 0))
  case "type":
    guard parts.count == 2, let data = Data(base64Encoded: parts[1]), let text = String(data: data, encoding: .utf8)
    else { return "err type needs base64 text" }
    type(text)
  default:
    return "err unknown command \(command)"
  }
  return "ok"
}

while let line = readLine() {
  if let reply = run(line) { print(reply) }
}
exit(0)
