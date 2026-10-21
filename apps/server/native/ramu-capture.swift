// Streams the screen (or one app's windows) as JPEG frames on stdout, using ScreenCaptureKit.
// Frames are produced only when the screen changes. Message framing: u32 big-endian length of (kind + payload), then
// one kind byte (1 = JSON metadata, 2 = JPEG frame), then the payload.
import AppKit
import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

setvbuf(stdout, nil, _IOFBF, 1 << 20)

struct Options {
  var maxEdge = 1600
  var fps = 15
  var quality = 0.6
  var app: String?
}

func parse() -> Options {
  var options = Options()
  var args = CommandLine.arguments.dropFirst()
  while let flag = args.popFirst() {
    switch flag {
    case "--max-edge": if let v = args.popFirst(), let n = Int(v), n >= 200, n <= 4096 { options.maxEdge = n }
    case "--fps": if let v = args.popFirst(), let n = Int(v), n >= 1, n <= 30 { options.fps = n }
    case "--quality": if let v = args.popFirst(), let q = Double(v), q > 0.1, q <= 1 { options.quality = q }
    case "--app": options.app = args.popFirst()
    default: break
    }
  }
  return options
}

func write(kind: UInt8, _ payload: Data) {
  var length = UInt32(payload.count + 1).bigEndian
  _ = withUnsafeBytes(of: &length) { fwrite($0.baseAddress, 1, 4, stdout) }
  var k = kind
  fwrite(&k, 1, 1, stdout)
  payload.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, payload.count, stdout) }
  fflush(stdout)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(code)
}

var firstFrame = false

final class Output: NSObject, SCStreamOutput, SCStreamDelegate {
  let context = CIContext(options: [.useSoftwareRenderer: false])
  let quality: Double
  var sentMeta = false
  let lock = NSLock()
  let pointsWidth: Double
  init(quality: Double, pointsWidth: Double) {
    self.quality = quality
    self.pointsWidth = pointsWidth
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
      let buffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }
    emit(CIImage(cvPixelBuffer: buffer))
  }

  func emit(_ image: CIImage) {
    let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    guard
      let jpeg = context.jpegRepresentation(
        of: image, colorSpace: space,
        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality])
    else { return }
    lock.lock()
    defer { lock.unlock() }
    firstFrame = true
    let width = Int(image.extent.width), height = Int(image.extent.height)
    if !sentMeta {
      sentMeta = true
      let meta = ["width": width, "height": height, "pointsWidth": pointsWidth] as [String: Any]
      write(kind: 1, (try? JSONSerialization.data(withJSONObject: meta)) ?? Data())
    }
    write(kind: 2, jpeg)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fail("The screen stream stopped: \(error.localizedDescription)", code: 3)
  }
}

let options = parse()

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first
    else { fail("No display is available to capture.") }
    let filter: SCContentFilter
    if let name = options.app {
      let apps = content.applications.filter { $0.applicationName == name }
      if apps.isEmpty { fail("\(name) is not running.", code: 4) }
      filter = SCContentFilter(display: display, including: apps, exceptingWindows: [])
    } else {
      filter = SCContentFilter(display: display, excludingWindows: [])
    }
    let scale = Double(filter.pointPixelScale)
    let pointsWidth = Double(display.width)
    let longEdge = Double(max(display.width, display.height)) * scale
    let shrink = min(1.0, Double(options.maxEdge) / longEdge)
    let configuration = SCStreamConfiguration()
    configuration.width = max(2, Int((Double(display.width) * scale * shrink).rounded()))
    configuration.height = max(2, Int((Double(display.height) * scale * shrink).rounded()))
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(options.fps))
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.queueDepth = 3
    configuration.showsCursor = true
    let output = Output(quality: options.quality, pointsWidth: pointsWidth)
    let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "ramu.capture"))
    try await stream.startCapture()
    // A still screen sends no frames, so take one now instead of waiting for the first change.
    if #available(macOS 14.0, *) {
      if let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) {
        output.emit(CIImage(cgImage: image))
      }
    }
  } catch {
    let text = error.localizedDescription
    fail(
      text.lowercased().contains("declined") || text.lowercased().contains("permission")
        ? "Screen Recording is not allowed for Ramu." : "Could not start the screen stream: \(text)",
      code: 2)
  }
}

// A screen with no permission can wait on a system prompt forever: report it instead of hanging.
DispatchQueue.global().asyncAfter(deadline: .now() + 12) {
  if !firstFrame { fail("No frame arrived. Screen Recording may not be allowed for Ramu.", code: 5) }
}

// Stop when the host closes our input or goes away.
DispatchQueue.global().async {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  exit(0)
}
RunLoop.main.run()
