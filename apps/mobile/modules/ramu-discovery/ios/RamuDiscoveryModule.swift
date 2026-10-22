import ExpoModulesCore
import Foundation

/// Browses Bonjour for Ramu hosts on this phone's network and reports each resolved host. It only reports: nothing here
/// pairs, connects or sends data to a host. The service type comes from the JS layer, which treats every field as
/// untrusted. iOS asks for Local Network access the first time this runs; a refusal is reported as `permission`.
public class RamuDiscoveryModule: Module {
  private var session: Session?

  public func definition() -> ModuleDefinition {
    Name("RamuDiscovery")
    Events("onResult", "onLost", "onError")

    AsyncFunction("start") { (service: String, maxMs: Double) in
      self.stop()
      let next = Session(
        service: service,
        onResult: { [weak self] body in self?.sendEvent("onResult", body) },
        onLost: { [weak self] key in self?.sendEvent("onLost", ["key": key]) },
        onError: { [weak self] code in self?.sendEvent("onError", ["code": code]) }
      )
      self.session = next
      next.start()
    }

    AsyncFunction("stop") { self.stop() }

    OnDestroy { self.stop() }
  }

  private func stop() {
    session?.stop()
    session = nil
  }

  /// One browse. Everything runs on the main run loop, as NetServiceBrowser requires.
  private final class Session: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let service: String
    private let onResult: ([String: Any]) -> Void
    private let onLost: (String) -> Void
    private let onError: (String) -> Void
    private let browser = NetServiceBrowser()
    private var resolving: [String: NetService] = [:]
    private var stopped = false
    private static let limit = 100

    init(
      service: String, onResult: @escaping ([String: Any]) -> Void, onLost: @escaping (String) -> Void,
      onError: @escaping (String) -> Void
    ) {
      self.service = service
      self.onResult = onResult
      self.onLost = onLost
      self.onError = onError
      super.init()
      browser.delegate = self
    }

    func start() {
      DispatchQueue.main.async {
        guard !self.stopped else { return }
        self.browser.searchForServices(ofType: "\(self.service).", inDomain: "local.")
      }
    }

    func stop() {
      stopped = true
      DispatchQueue.main.async {
        self.browser.stop()
        for found in self.resolving.values {
          found.delegate = nil
          found.stop()
        }
        self.resolving.removeAll()
      }
    }

    private func key(_ found: NetService) -> String { "\(found.name).\(found.type)\(found.domain)" }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
      guard !stopped else { return }
      // iOS reports a refused Local Network permission as -72008; anything else is an unavailable network.
      let code = errorDict[NetService.errorCode]?.intValue ?? 0
      onError(code == -72008 ? "permission" : "unavailable")
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind found: NetService, moreComing: Bool) {
      guard !stopped, resolving.count < Session.limit else { return }
      resolving[key(found)] = found
      found.delegate = self
      found.resolve(withTimeout: 5)
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove found: NetService, moreComing: Bool) {
      let id = key(found)
      resolving[id]?.delegate = nil
      resolving[id]?.stop()
      resolving[id] = nil
      guard !stopped else { return }
      // Every address of the instance is withdrawn together.
      onLost(id)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
      guard !stopped else { return }
      let txt = (sender.txtRecordData()).map { NetService.dictionary(fromTXTRecord: $0) } ?? [:]
      let entries: [String] = txt.compactMap { entry in
        guard let value = String(data: entry.value, encoding: .utf8) else { return nil }
        return "\(entry.key)=\(value)"
      }
      for data in sender.addresses ?? [] {
        guard let address = Session.numeric(data) else { continue }
        onResult([
          "key": "\(key(sender))/\(address)",
          "txt": entries,
          "address": address,
          "port": sender.port,
          "ttlMs": 120_000,
        ])
      }
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
      resolving[key(sender)] = nil
    }

    /// The numeric IPv4/IPv6 literal of a socket address, without a zone: a scoped address is not offered.
    private static func numeric(_ data: Data) -> String? {
      data.withUnsafeBytes { raw -> String? in
        guard let base = raw.baseAddress else { return nil }
        let family = base.assumingMemoryBound(to: sockaddr.self).pointee.sa_family
        guard family == sa_family_t(AF_INET) || family == sa_family_t(AF_INET6) else { return nil }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
          base.assumingMemoryBound(to: sockaddr.self), socklen_t(data.count), &host, socklen_t(host.count), nil, 0,
          NI_NUMERICHOST)
        guard result == 0 else { return nil }
        let text = String(cString: host)
        return text.contains("%") ? nil : text
      }
    }
  }
}
