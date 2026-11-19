import AVFoundation
import ExpoModulesCore
import Speech

/// The failure reason words the JS layer maps to typed errors travel as the exception's message.
private func Fail(_ reason: String) -> Exception { Exception(name: "RamuSpeechError", description: reason) }

/// On-device dictation. One take at a time: `start` opens the microphone and an on-device recognition request,
/// `stop` ends the audio and returns the final text, `cancel` discards everything. Recognition never uses Apple's
/// servers (`requiresOnDeviceRecognition`); a language without an installed on-device model is reported as
/// `language` instead. No audio is written to disk. Failures are thrown with one of the reason words the JS layer maps:
/// permission, unavailable, language, capture, recognition.
public class RamuSpeechModule: Module {
  private var take: Take?

  public func definition() -> ModuleDefinition {
    Name("RamuSpeech")
    Events("onLevel", "onInterrupt", "onLimit")

    AsyncFunction("capability") { (language: String) -> [String: Any] in
      Self.capability(language)
    }

    AsyncFunction("start") { (language: String, maxMs: Double, maxBytes: Double) async throws in
      self.discard()
      guard try await Self.authorize() else { throw Fail("permission") }
      guard let recognizer = SFSpeechRecognizer(locale: Self.locale(language)), recognizer.isAvailable else {
        throw Fail("unavailable")
      }
      guard recognizer.supportsOnDeviceRecognition else { throw Fail("language") }
      let next = Take(
        recognizer: recognizer,
        maxMs: maxMs,
        maxBytes: maxBytes,
        onLevel: { [weak self] level in self?.sendEvent("onLevel", ["level": level]) },
        onInterrupt: { [weak self] in
          self?.sendEvent("onInterrupt")
          self?.discard()
        },
        onLimit: { [weak self] in self?.sendEvent("onLimit") }
      )
      self.take = next
      try next.begin()
    }

    AsyncFunction("stop") { () async throws -> String in
      guard let current = self.take else { throw Fail("capture") }
      self.take = nil
      return try await current.finish()
    }

    AsyncFunction("cancel") { () in self.discard() }

    OnDestroy { self.discard() }
  }

  private func discard() {
    take?.cancel()
    take = nil
  }

  private static func locale(_ language: String) -> Locale {
    language.isEmpty || language == "system" ? Locale.current : Locale(identifier: language)
  }

  private static func tag(_ locale: Locale) -> String { locale.identifier.replacingOccurrences(of: "_", with: "-") }

  private static func microphoneStatus() -> AVAudioSession.RecordPermission { AVAudioSession.sharedInstance().recordPermission }

  /// Readiness without asking for anything: permission is requested only when the person starts a take.
  private static func capability(_ language: String) -> [String: Any] {
    let languages = SFSpeechRecognizer.supportedLocales()
      .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
      .map(tag)
      .sorted()
    var result: [String: Any] = ["languages": languages, "onDevice": true]
    guard let recognizer = SFSpeechRecognizer(locale: locale(language)) else {
      result["readiness"] = "language-unsupported"
      return result
    }
    result["resolvedLanguage"] = tag(recognizer.locale)
    if !recognizer.supportsOnDeviceRecognition {
      result["readiness"] = "language-unsupported"
      return result
    }
    let speech = SFSpeechRecognizer.authorizationStatus()
    let microphone = microphoneStatus()
    if speech == .denied || speech == .restricted || microphone == .denied {
      result["readiness"] = "permission-denied"
    } else if speech == .notDetermined || microphone == .undetermined {
      result["readiness"] = "permission-needed"
    } else {
      result["readiness"] = "ready"
    }
    return result
  }

  /// Asks for speech recognition and the microphone, each at most once; a denial is final until system settings change it.
  private static func authorize() async throws -> Bool {
    var speech = SFSpeechRecognizer.authorizationStatus()
    if speech == .notDetermined {
      speech = await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
      }
    }
    guard speech == .authorized else { return false }
    switch microphoneStatus() {
    case .granted: return true
    case .denied: return false
    default:
      return await withCheckedContinuation { continuation in
        AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
      }
    }
  }

  /// One recording and its recognition. Everything audio-related is torn down in `cancel`, which is safe to call twice.
  private final class Take {
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private let recognizer: SFSpeechRecognizer
    private var task: SFSpeechRecognitionTask?
    private let maxMs: Double
    private let maxBytes: Double
    private let onLevel: (Double) -> Void
    private let onInterrupt: () -> Void
    private let onLimit: () -> Void
    private var bytes = 0.0
    private var startedAt = Date()
    private var lastLevelAt = Date.distantPast
    private var limited = false
    private var closed = false
    private var latest = ""
    private var final: CheckedContinuation<String, Error>?
    private var observers: [NSObjectProtocol] = []

    init(
      recognizer: SFSpeechRecognizer, maxMs: Double, maxBytes: Double, onLevel: @escaping (Double) -> Void,
      onInterrupt: @escaping () -> Void, onLimit: @escaping () -> Void
    ) {
      self.recognizer = recognizer
      self.maxMs = maxMs
      self.maxBytes = maxBytes
      self.onLevel = onLevel
      self.onInterrupt = onInterrupt
      self.onLimit = onLimit
    }

    func begin() throws {
      request.requiresOnDeviceRecognition = true
      request.shouldReportPartialResults = true
      request.taskHint = .dictation
      let session = AVAudioSession.sharedInstance()
      do {
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
      } catch {
        throw Fail("capture")
      }
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0 else { throw Fail("capture") }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in self?.tapped(buffer) }
      observers.append(
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
          let kind = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(
            AVAudioSession.InterruptionType.init(rawValue:))
          if kind == .began { self?.onInterrupt() }
        })
      observers.append(
        NotificationCenter.default.addObserver(
          forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] note in
          let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(
            AVAudioSession.RouteChangeReason.init(rawValue:))
          if reason == .oldDeviceUnavailable { self?.onInterrupt() }
        })
      task = recognizer.recognitionTask(with: request) { [weak self] result, error in
        guard let self = self else { return }
        if let result = result {
          self.latest = result.bestTranscription.formattedString
          if result.isFinal { self.resolve(.success(self.latest)) }
        }
        if error != nil, !self.closed { self.resolve(self.latest.isEmpty ? .failure(Fail("recognition")) : .success(self.latest)) }
      }
      engine.prepare()
      do { try engine.start() } catch { cancel(); throw Fail("capture") }
      startedAt = Date()
    }

    private func tapped(_ buffer: AVAudioPCMBuffer) {
      guard !closed, !limited else { return }
      request.append(buffer)
      bytes += Double(buffer.frameLength) * Double(buffer.format.streamDescription.pointee.mBytesPerFrame)
      if let data = buffer.floatChannelData?[0], buffer.frameLength > 0 {
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += data[index] * data[index] }
        let level = min(1.0, Double((sum / Float(buffer.frameLength)).squareRoot()) * 8)
        if Date().timeIntervalSince(lastLevelAt) > 0.08 {
          lastLevelAt = Date()
          DispatchQueue.main.async { self.onLevel(level) }
        }
      }
      if bytes >= maxBytes || Date().timeIntervalSince(startedAt) * 1000 >= maxMs {
        limited = true
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        DispatchQueue.main.async { self.onLimit() }
      }
    }

    /// Ends the audio and waits (bounded) for recognition to finish; a take that heard nothing is `recognition`.
    func finish() async throws -> String {
      if !limited {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
      }
      let text: String = try await withCheckedThrowingContinuation { continuation in
        final = continuation
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
          guard let self = self else { return }
          self.resolve(self.latest.isEmpty ? .failure(Fail("recognition")) : .success(self.latest))
        }
      }
      teardown()
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.isEmpty { throw Fail("recognition") }
      return trimmed
    }

    private func resolve(_ result: Result<String, Error>) {
      guard let continuation = final else { return }
      final = nil
      continuation.resume(with: result)
    }

    func cancel() {
      resolve(.failure(Fail("capture")))
      task?.cancel()
      teardown()
    }

    private func teardown() {
      guard !closed else { return }
      closed = true
      if engine.isRunning {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
      }
      task = nil
      observers.forEach { NotificationCenter.default.removeObserver($0) }
      observers.removeAll()
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }
}
