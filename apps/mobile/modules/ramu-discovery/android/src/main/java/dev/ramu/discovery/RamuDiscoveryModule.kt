package dev.ramu.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.Inet6Address
import java.util.ArrayDeque

/**
 * Browses NSD (mDNS) for Ramu hosts and reports each resolved host. It only reports: nothing here pairs, connects or
 * sends data to a host. The JS layer treats every field as untrusted. Holds a multicast lock only while browsing.
 */
class RamuDiscoveryModule : Module() {
  private var manager: NsdManager? = null
  private var listener: NsdManager.DiscoveryListener? = null
  private var lock: WifiManager.MulticastLock? = null
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private var generation = 0

  override fun definition() = ModuleDefinition {
    Name("RamuDiscovery")
    Events("onResult", "onLost", "onError")

    AsyncFunction("start") { service: String, _: Double -> start(service) }
    AsyncFunction("stop") { stop() }
    OnDestroy { stop() }
  }

  private fun start(service: String) {
    stop()
    val context = appContext.reactContext ?: run {
      sendEvent("onError", mapOf("code" to "unavailable"))
      return
    }
    val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: run {
      sendEvent("onError", mapOf("code" to "unavailable"))
      return
    }
    val mine = ++generation
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    lock = wifi?.createMulticastLock("ramu-discovery")?.apply {
      setReferenceCounted(false)
      acquire()
    }
    val found = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, code: Int) {
        if (mine == generation) sendEvent("onError", mapOf("code" to "unavailable"))
      }
      override fun onStopDiscoveryFailed(type: String, code: Int) {}
      override fun onServiceFound(info: NsdServiceInfo) {
        if (mine != generation || pending.size >= 100) return
        pending.add(info)
        resolveNext(nsd, mine)
      }
      override fun onServiceLost(info: NsdServiceInfo) {
        if (mine == generation) sendEvent("onLost", mapOf("key" to key(info)))
      }
    }
    manager = nsd
    listener = found
    try {
      nsd.discoverServices("$service.", NsdManager.PROTOCOL_DNS_SD, found)
    } catch (error: Exception) {
      sendEvent("onError", mapOf("code" to "unavailable"))
    }
  }

  private fun key(info: NsdServiceInfo) = "${info.serviceName}.${info.serviceType}"

  /** Older Android resolves one service at a time, so results queue. */
  @Suppress("DEPRECATION")
  private fun resolveNext(nsd: NsdManager, mine: Int) {
    if (resolving || mine != generation) return
    val next = pending.poll() ?: return
    resolving = true
    nsd.resolveService(next, object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
        resolving = false
        resolveNext(nsd, mine)
      }
      override fun onServiceResolved(info: NsdServiceInfo) {
        resolving = false
        if (mine == generation) report(info)
        resolveNext(nsd, mine)
      }
    })
  }

  @Suppress("DEPRECATION")
  private fun report(info: NsdServiceInfo) {
    val address = info.host ?: return
    // Scoped and link-local addresses are not offered; the JS layer checks again.
    val text = address.hostAddress?.substringBefore('%') ?: return
    if (address !is Inet4Address && address !is Inet6Address) return
    val entries = info.attributes.mapNotNull { (name, value) ->
      value?.let { "$name=${String(it, Charsets.UTF_8)}" }
    }
    sendEvent(
      "onResult",
      mapOf(
        "key" to "${key(info)}/$text",
        "txt" to entries,
        "address" to text,
        "port" to info.port,
        "ttlMs" to 120_000,
      ),
    )
  }

  private fun stop() {
    generation++
    pending.clear()
    resolving = false
    val nsd = manager
    val active = listener
    if (nsd != null && active != null) {
      try {
        nsd.stopServiceDiscovery(active)
      } catch (error: Exception) {
        // Already stopped.
      }
    }
    listener = null
    manager = null
    lock?.let { if (it.isHeld) it.release() }
    lock = null
  }
}
