// Streams the screen (or one app's windows) as JPEG frames on stdout, using ScreenCaptureKit.
// Frames are produced only when the screen changes. Message framing: u32 big-endian length of (kind + payload), then
// one kind byte (1 = JSON metadata, 2 = JPEG frame, 3 = H.264 access unit: a flag byte, 1 for a key frame, then
// Annex-B bytes with SPS/PPS before every key frame), then the payload. With --h264 only kinds 1 and 3 are sent.
import AppKit
import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import VideoToolbox
import UniformTypeIdentifiers

setvbuf(stdout, nil, _IOFBF, 1 << 20)

struct Options {
  var maxEdge = 1600
  var fps = 15
  var quality = 0.6
  var app: String?
  var h264 = false
  var bitrate = 2_500_000
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
    case "--h264": options.h264 = true
    case "--bitrate": if let v = args.popFirst(), let n = Int(v), n >= 200_000, n <= 20_000_000 { options.bitrate = n }
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


/// Hardware H.264 (constrained baseline, no frame reordering) so a WebRTC receiver can play it with low delay.
final class H264Encoder {
  private var session: VTCompressionSession?
  private let emit: (Bool, Data) -> Void
  init?(width: Int, height: Int, fps: Int, bitrate: Int, emit: @escaping (Bool, Data) -> Void) {
    self.emit = emit
    var created: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
      outputCallback: nil, refcon: nil, compressionSessionOut: &created)
    guard status == noErr, let session = created else { return nil }
    self.session = session
    func set(_ key: CFString, _ value: CFTypeRef) { VTSessionSetProperty(session, key: key, value: value) }
    set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
    set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_ConstrainedBaseline_AutoLevel)
    set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
    set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 2 as CFNumber)
    set(kVTCompressionPropertyKey_ExpectedFrameRate, fps as CFNumber)
    set(kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber)
    VTCompressionSessionPrepareToEncodeFrames(session)
  }

  func encode(_ buffer: CVPixelBuffer, at time: CMTime, forceKey: Bool) {
    guard let session else { return }
    let properties: CFDictionary? = forceKey ? [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary : nil
    VTCompressionSessionEncodeFrame(
      session, imageBuffer: buffer, presentationTimeStamp: time, duration: .invalid, frameProperties: properties,
      infoFlagsOut: nil
    ) { [emit] status, _, sample in
      guard status == noErr, let sample, let block = CMSampleBufferGetDataBuffer(sample) else { return }
      let notSync =
        (CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]])?.first?[
          kCMSampleAttachmentKey_NotSync] as? Bool ?? false
      let isKey = !notSync
      var out = Data()
      let start: [UInt8] = [0, 0, 0, 1]
      if isKey, let format = CMSampleBufferGetFormatDescription(sample) {
        var count = 0
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
          format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
          parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
        for index in 0..<count {
          var pointer: UnsafePointer<UInt8>?
          var size = 0
          if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &size,
            parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pointer
          {
            out.append(contentsOf: start)
            out.append(pointer, count: size)
          }
        }
      }
      var length = 0
      var pointer: UnsafeMutablePointer<Int8>?
      guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer) == noErr,
        let pointer
      else { return }
      var offset = 0
      while offset + 4 <= length {
        var nal: UInt32 = 0
        memcpy(&nal, pointer + offset, 4)
        let size = Int(UInt32(bigEndian: nal))
        offset += 4
        guard size > 0, offset + size <= length else { break }
        out.append(contentsOf: start)
        out.append(Data(bytes: pointer + offset, count: size))
        offset += size
      }
      emit(isKey, out)
    }
  }

  func close() {
    if let session { VTCompressionSessionInvalidate(session) }
    session = nil
  }
}

var firstFrame = false
// The stream and its output must outlive the task that starts them, or capture stops as soon as that task ends.
var liveStream: SCStream?
var liveOutput: Output?
var wantKeyFrame = true
var keyFrameRequest: (() -> Void)?

final class Output: NSObject, SCStreamOutput, SCStreamDelegate {
  let context = CIContext(options: [.useSoftwareRenderer: false])
  let quality: Double
  var sentMeta = false
  let lock = NSLock()
  let pointsWidth: Double
  var encoder: H264Encoder?
  var lastBuffer: CVPixelBuffer?
  let width: Int
  let height: Int
  init(quality: Double, pointsWidth: Double, width: Int, height: Int) {
    self.quality = quality
    self.pointsWidth = pointsWidth
    self.width = width
    self.height = height
  }

  func sendMeta() {
    if sentMeta { return }
    sentMeta = true
    let meta = ["width": width, "height": height, "pointsWidth": pointsWidth] as [String: Any]
    write(kind: 1, (try? JSONSerialization.data(withJSONObject: meta)) ?? Data())
  }

  /// Encodes one frame as H.264 (or the last one again, for a key frame a new viewer asked for).
  func encode(_ buffer: CVPixelBuffer) {
    lock.lock()
    defer { lock.unlock() }
    lastBuffer = buffer
    firstFrame = true
    sendMeta()
    let key = wantKeyFrame
    wantKeyFrame = false
    encoder?.encode(buffer, at: CMClockGetTime(CMClockGetHostTimeClock()), forceKey: key)
  }

  func refreshKeyFrame() {
    lock.lock()
    let buffer = lastBuffer
    lock.unlock()
    wantKeyFrame = true
    if let buffer { encode(buffer) }
  }

  var seen = 0
  var complete = 0
  var lastLog = Date()

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    seen += 1
    if ProcessInfo.processInfo.environment["RAMU_CAPTURE_DEBUG"] != nil, Date().timeIntervalSince(lastLog) > 1 {
      FileHandle.standardError.write(Data("stream buffers=\(seen) complete=\(complete)\n".utf8))
      lastLog = Date()
    }
    guard type == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
      let buffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }
    complete += 1
    if encoder != nil { encode(buffer) } else { emit(CIImage(cvPixelBuffer: buffer)) }
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
    configuration.pixelFormat = options.h264 ? kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange : kCVPixelFormatType_32BGRA
    configuration.queueDepth = 3
    configuration.showsCursor = true
    let output = Output(
      quality: options.quality, pointsWidth: pointsWidth, width: configuration.width, height: configuration.height)
    if options.h264 {
      output.encoder = H264Encoder(
        width: configuration.width, height: configuration.height, fps: options.fps, bitrate: options.bitrate
      ) { key, annexB in
        var payload = Data([key ? 1 : 0])
        payload.append(annexB)
        write(kind: 3, payload)
      }
      if output.encoder == nil { fail("The hardware video encoder is not available.", code: 6) }
      keyFrameRequest = { output.refreshKeyFrame() }
    }
    let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
    liveStream = stream
    liveOutput = output
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "ramu.capture"))
    try await stream.startCapture()
    // A still screen sends no frames, so take one now instead of waiting for the first change.
    if #available(macOS 14.0, *) {
      if let image = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) {
        if options.h264 {
          var pixel: CVPixelBuffer?
          CVPixelBufferCreate(
            nil, configuration.width, configuration.height, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel)
          if let pixel {
            output.context.render(CIImage(cgImage: image), to: pixel)
            output.encode(pixel)
          }
        } else {
          output.emit(CIImage(cgImage: image))
        }
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
// A line `K` asks for a key frame (a viewer joined); end of input means the host is gone.
DispatchQueue.global().async {
  while let line = readLine() {
    if line.trimmingCharacters(in: .whitespaces) == "K" { keyFrameRequest?() }
  }
  exit(0)
}
RunLoop.main.run()
