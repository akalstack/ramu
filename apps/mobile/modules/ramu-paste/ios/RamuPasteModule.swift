import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// Lets the system Paste in a text field take a copied picture or file. React Native's text fields paste text only, so
/// with a picture on the clipboard Paste did nothing. While JS listens, Paste is offered for a picture or file and
/// hands it to JS as a file in the app's temporary folder; text still pastes as text. Nothing here sends anything.
public class RamuPasteModule: Module {
  fileprivate static weak var listening: RamuPasteModule?
  private static var installed = false
  /// The attachment limit; a larger item is reported so the composer can say why it was not attached.
  private static let maxBytes = 10_000_000

  public func definition() -> ModuleDefinition {
    Name("RamuPaste")
    Events("onPaste")

    OnCreate { DispatchQueue.main.async { Self.install() } }
    OnStartObserving { Self.listening = self }
    OnStopObserving { if Self.listening === self { Self.listening = nil } }
  }

  /// Whether Paste should be offered for what is on the clipboard: a picture or a file, not text.
  fileprivate static func offers() -> Bool {
    guard listening != nil else { return false }
    let board = UIPasteboard.general
    return board.hasImages || (!board.hasStrings && !board.hasURLs && board.numberOfItems > 0)
  }

  /// Takes the clipboard's picture or file for JS. False leaves the paste to the text field.
  fileprivate static func take() -> Bool {
    guard let module = listening, offers() else { return false }
    let board = UIPasteboard.general
    var files: [[String: Any]] = []
    if board.hasImages, let images = board.images {
      for (index, image) in images.prefix(10).enumerated() {
        guard let data = image.jpegData(compressionQuality: 0.85) else { continue }
        if let file = write(data, name: "pasted-\(stamp())-\(index + 1).jpg", type: "image/jpeg") { files.append(file) }
      }
    } else {
      for (index, item) in board.items.prefix(10).enumerated() {
        // A copied file arrives as its content type, or as a URL to the file; text and web links stay text.
        let entry = item.first { key, value in
          guard let type = UTType(key), !type.conforms(to: .text) else { return false }
          if let url = value as? URL { return url.isFileURL }
          return !type.conforms(to: .url)
        }
        guard let (identifier, value) = entry else { continue }
        let fileURL = value as? URL
        let type = fileURL.flatMap { UTType(filenameExtension: $0.pathExtension) } ?? UTType(identifier)
        let data: Data? =
          (value as? Data) ?? fileURL.flatMap { try? Data(contentsOf: $0) }
          ?? (value as? UIImage)?.jpegData(compressionQuality: 0.85)
        guard let data else { continue }
        let suffix = type?.preferredFilenameExtension.map { ".\($0)" } ?? ""
        let name = fileURL?.lastPathComponent ?? "pasted-\(stamp())-\(index + 1)\(suffix)"
        if let file = write(data, name: name, type: type?.preferredMIMEType ?? "application/octet-stream") {
          files.append(file)
        }
      }
    }
    guard !files.isEmpty else { return false }
    module.sendEvent("onPaste", ["files": files])
    return true
  }

  private static func stamp() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

  private static func write(_ data: Data, name: String, type: String) -> [String: Any]? {
    if data.count > maxBytes { return ["name": name, "mimeType": type, "size": data.count, "uri": ""] }
    // Each paste gets its own folder, so a file keeps its name without overwriting an earlier one.
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("ramu-paste-\(UUID().uuidString)")
    let url = folder.appendingPathComponent(name)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
    } catch {
      return nil
    }
    return ["uri": url.absoluteString, "name": name, "mimeType": type, "size": data.count]
  }

  /// Wraps Paste on React Native's two text field classes once; each keeps its own behaviour unless this takes the paste.
  private static func install() {
    guard !installed else { return }
    installed = true
    for name in ["RCTUITextView", "RCTUITextField"] {
      guard let cls = NSClassFromString(name) else { continue }
      wrapPaste(cls)
      wrapCanPerform(cls)
    }
  }

  /// The class's own method only: wrapping one it inherits would change every UIKit text field.
  private static func ownMethod(_ cls: AnyClass, _ selector: Selector) -> Method? {
    guard let method = class_getInstanceMethod(cls, selector) else { return nil }
    if let parent = class_getSuperclass(cls), class_getInstanceMethod(parent, selector) == method { return nil }
    return method
  }

  private static func wrapPaste(_ cls: AnyClass) {
    let selector = #selector(UIResponderStandardEditActions.paste(_:))
    guard let method = ownMethod(cls, selector) else { return }
    typealias Paste = @convention(c) (AnyObject, Selector, Any?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Paste.self)
    let block: @convention(block) (AnyObject, Any?) -> Void = { this, sender in
      if take() { return }
      original(this, selector, sender)
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }

  private static func wrapCanPerform(_ cls: AnyClass) {
    let selector = #selector(UIResponder.canPerformAction(_:withSender:))
    guard let method = ownMethod(cls, selector) else { return }
    typealias CanPerform = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
    let original = unsafeBitCast(method_getImplementation(method), to: CanPerform.self)
    let paste = #selector(UIResponderStandardEditActions.paste(_:))
    let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = { this, action, sender in
      if action == paste, offers() { return true }
      return original(this, selector, action, sender)
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }
}
