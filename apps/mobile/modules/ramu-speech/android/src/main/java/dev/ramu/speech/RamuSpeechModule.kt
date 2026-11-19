package dev.ramu.speech

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

/**
 * On-device dictation. Only the device's own recognizer is used (API 31+ `createOnDeviceSpeechRecognizer`); a device
 * without one reports `unsupported`, because a recognizer that may reach a server is never used. One take at a time.
 * The microphone permission is asked from JavaScript, once; this module only reports whether it is held. Android ends a
 * recognition after a pause, so a take keeps listening again until `stop`, the time limit or an interruption.
 * Failures are rejected with one of the reason words the JS layer maps: permission, unavailable, language, capture,
 * recognition, model.
 */
class RamuSpeechModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var take: Take? = null

  override fun definition() = ModuleDefinition {
    Name("RamuSpeech")
    Events("onLevel", "onInterrupt", "onLimit")

    AsyncFunction("capability") { language: String, promise: Promise -> main.post { capability(language, promise) } }
    AsyncFunction("downloadModel") { language: String, promise: Promise -> main.post { download(language, promise) } }
    AsyncFunction("start") { language: String, maxMs: Double, _: Double, promise: Promise ->
      main.post { start(language, maxMs.toLong(), promise) }
    }
    AsyncFunction("stop") { promise: Promise -> main.post { stop(promise) } }
    AsyncFunction("cancel") { promise: Promise ->
      main.post {
        discard()
        promise.resolve(null)
      }
    }
    OnDestroy { main.post { discard() } }
  }

  private fun context(): Context? = appContext.reactContext

  private fun tag(language: String): String =
    if (language.isEmpty() || language == "system") Locale.getDefault().toLanguageTag() else language

  private fun fail(promise: Promise, reason: String) = promise.reject(CodedException(reason, reason, null))

  private fun onDeviceAvailable(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

  private fun intentFor(language: String): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag(language))
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
    }

  private fun capability(language: String, promise: Promise) {
    val context = context()
    val result = mutableMapOf<String, Any>("languages" to emptyList<String>(), "onDevice" to true)
    if (context == null || !onDeviceAvailable(context)) {
      result["readiness"] = "unsupported"
      result["onDevice"] = false
      promise.resolve(result)
      return
    }
    result["resolvedLanguage"] = tag(language)
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      // Installed languages cannot be listed before API 33; a missing one is reported when the take starts.
      result["readiness"] = if (granted) "ready" else "permission-needed"
      promise.resolve(result)
      return
    }
    val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    recognizer.checkRecognitionSupport(
      intentFor(language),
      ContextCompat.getMainExecutor(context),
      object : RecognitionSupportCallback {
        override fun onSupportResult(support: RecognitionSupport) {
          recognizer.destroy()
          val installed = support.installedOnDeviceLanguages
          val supported = support.supportedOnDeviceLanguages
          val wanted = tag(language)
          val has = { list: List<String> -> list.any { it.equals(wanted, true) || it.substringBefore('-').equals(wanted.substringBefore('-'), true) } }
          result["languages"] = installed
          result["readiness"] = when {
            has(installed) -> if (granted) "ready" else "permission-needed"
            has(supported) -> "model-needed"
            else -> "language-unsupported"
          }
          promise.resolve(result)
        }

        override fun onError(error: Int) {
          recognizer.destroy()
          result["readiness"] = "unsupported"
          result["onDevice"] = false
          promise.resolve(result)
        }
      },
    )
  }

  /** Asks the system recognizer to fetch the language pack itself; the caller checks capability again afterwards. */
  private fun download(language: String, promise: Promise) {
    val context = context()
    if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !onDeviceAvailable(context)) {
      fail(promise, "model")
      return
    }
    val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
    recognizer.triggerModelDownload(intentFor(language))
    main.postDelayed({ recognizer.destroy() }, 2000)
    promise.resolve(null)
  }

  private fun start(language: String, maxMs: Long, promise: Promise) {
    discard()
    val context = context()
    if (context == null || !onDeviceAvailable(context)) return fail(promise, "unavailable")
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
      return fail(promise, "permission")
    val next = Take(context, intentFor(language), maxMs)
    take = next
    next.begin()
    promise.resolve(null)
  }

  private fun stop(promise: Promise) {
    val current = take ?: return fail(promise, "capture")
    take = null
    current.finish(promise)
  }

  private fun discard() {
    take?.cancel()
    take = null
  }

  /** One recording. Restarts the recognizer after each pause and joins the pieces. */
  private inner class Take(private val context: Context, private val intent: Intent, private val maxMs: Long) :
    RecognitionListener {
    private var recognizer: SpeechRecognizer? = null
    private val committed = StringBuilder()
    private var partial = ""
    private var stopping = false
    private var limited = false
    private var closed = false
    private var waiter: Promise? = null
    private var lastLevelAt = 0L
    private val limit = Runnable {
      if (closed) return@Runnable
      limited = true
      sendEvent("onLimit")
      recognizer?.stopListening()
    }

    fun begin() {
      listen()
      main.postDelayed(limit, maxMs)
    }

    private fun listen() {
      if (closed) return
      recognizer?.destroy()
      val next = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
      next.setRecognitionListener(this)
      recognizer = next
      partial = ""
      next.startListening(intent)
    }

    private fun text(): String = (committed.toString() + " " + partial).trim()

    fun finish(promise: Promise) {
      if (closed) return fail(promise, "capture")
      stopping = true
      waiter = promise
      recognizer?.stopListening()
      // Results normally arrive within a moment; a recognizer that never answers still ends the take.
      main.postDelayed({ settle() }, 6000)
    }

    private fun settle() {
      val promise = waiter ?: return
      waiter = null
      val result = text()
      teardown()
      if (result.isEmpty()) fail(promise, "recognition") else promise.resolve(result)
    }

    fun cancel() {
      waiter?.let { fail(it, "capture") }
      waiter = null
      teardown()
    }

    private fun teardown() {
      if (closed) return
      closed = true
      main.removeCallbacks(limit)
      recognizer?.destroy()
      recognizer = null
    }

    private fun best(results: Bundle?): String =
      results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

    override fun onResults(results: Bundle?) {
      val piece = best(results)
      if (piece.isNotEmpty()) {
        if (committed.isNotEmpty()) committed.append(' ')
        committed.append(piece)
      }
      partial = ""
      if (stopping || limited) settle() else listen()
    }

    override fun onPartialResults(partialResults: Bundle?) {
      partial = best(partialResults)
    }

    override fun onError(error: Int) {
      when (error) {
        // A pause with nothing recognized: keep listening, or finish with what we have.
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
          if (stopping || limited) settle() else listen()
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> if (stopping || limited) settle()
        SpeechRecognizer.ERROR_AUDIO -> {
          sendEvent("onInterrupt")
          main.post { discard() }
        }
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> reject("permission")
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> reject("language")
        else -> reject("recognition")
      }
    }

    private fun reject(reason: String) {
      val promise = waiter
      waiter = null
      teardown()
      if (promise != null) fail(promise, reason) else sendEvent("onInterrupt")
    }

    override fun onRmsChanged(rmsdB: Float) {
      val now = System.currentTimeMillis()
      if (now - lastLevelAt < 80) return
      lastLevelAt = now
      sendEvent("onLevel", mapOf("level" to ((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble()))
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }
}
