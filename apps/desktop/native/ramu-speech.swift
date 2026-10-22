import Foundation
import Speech

// Ramu's macOS dictation helper. Electron main runs it on a temporary WAV the person just recorded and reads one line of
// JSON from stdout. Recognition is on-device only (`requiresOnDeviceRecognition`); a language without an installed
// on-device model is reported as unsupported rather than sent to Apple's servers. No audio is kept: main deletes the file.
//
//   ramu-speech capability <language>   -> {"readiness":..., "languages":[...], "resolvedLanguage":...}
//   ramu-speech authorize               -> {"status":"authorized"|"denied"|"restricted"|"undetermined"}
//   ramu-speech transcribe <wav> <lang> -> {"text":"..."} or {"error":"permission|language|recognition|empty"}

func emit(_ value: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) {
    print(text)
    fflush(stdout)
  }
}

func localeFor(_ language: String) -> Locale {
  language.isEmpty || language == "system" ? Locale.current : Locale(identifier: language)
}

func tag(_ locale: Locale) -> String { locale.identifier.replacingOccurrences(of: "_", with: "-") }

func statusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
  switch status {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "undetermined"
  @unknown default: return "undetermined"
  }
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  emit(["error": "recognition"])
  exit(2)
}

switch arguments[1] {
case "capability":
  let language = arguments.count > 2 ? arguments[2] : "system"
  let languages = SFSpeechRecognizer.supportedLocales()
    .filter { SFSpeechRecognizer(locale: $0)?.supportsOnDeviceRecognition == true }
    .map(tag)
    .sorted()
  var result: [String: Any] = ["languages": languages]
  if let recognizer = SFSpeechRecognizer(locale: localeFor(language)) {
    result["resolvedLanguage"] = tag(recognizer.locale)
    if !recognizer.supportsOnDeviceRecognition {
      result["readiness"] = "language-unsupported"
    } else {
      switch SFSpeechRecognizer.authorizationStatus() {
      case .authorized: result["readiness"] = "ready"
      case .notDetermined: result["readiness"] = "permission-needed"
      default: result["readiness"] = "permission-denied"
      }
    }
  } else {
    result["readiness"] = "language-unsupported"
  }
  emit(result)

case "authorize":
  let current = SFSpeechRecognizer.authorizationStatus()
  if current != .notDetermined {
    emit(["status": statusName(current)])
  } else {
    SFSpeechRecognizer.requestAuthorization { status in
      emit(["status": statusName(status)])
      exit(0)
    }
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 120))
  }

case "transcribe":
  guard arguments.count >= 4 else {
    emit(["error": "recognition"])
    exit(2)
  }
  guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
    emit(["error": "permission"])
    exit(3)
  }
  guard let recognizer = SFSpeechRecognizer(locale: localeFor(arguments[3])), recognizer.supportsOnDeviceRecognition else {
    emit(["error": "language"])
    exit(3)
  }
  let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: arguments[2]))
  request.requiresOnDeviceRecognition = true
  request.shouldReportPartialResults = false
  request.taskHint = .dictation
  var finished = false
  let task = recognizer.recognitionTask(with: request) { result, error in
    guard !finished else { return }
    if let result = result, result.isFinal {
      finished = true
      let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
      emit(text.isEmpty ? ["error": "empty"] : ["text": text])
      exit(0)
    } else if error != nil {
      finished = true
      emit(["error": "recognition"])
      exit(4)
    }
  }
  _ = task
  RunLoop.main.run(until: Date(timeIntervalSinceNow: 120))
  emit(["error": "recognition"])
  exit(4)

default:
  emit(["error": "recognition"])
  exit(2)
}
