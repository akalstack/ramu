package dev.ramu.paste

import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.view.View
import android.webkit.MimeTypeMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * Lets the system Paste, and a picture inserted from the keyboard, reach the message box as a file. A text field takes
 * text only, so with a picture on the clipboard Paste did nothing. From Android 12 a watched field hands every
 * non-text item to JS as a copy in the app's cache; text still pastes as text. Nothing here sends anything.
 */
class RamuPasteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RamuPaste")
    Events("onPaste")

    /** Watches the text field with this view tag; false where the system cannot hand content over (before Android 12). */
    AsyncFunction("watch") { tag: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@AsyncFunction false
      val view = appContext.findView<View>(tag) ?: return@AsyncFunction false
      view.post { watch(view) }
      true
    }
  }

  private fun watch(view: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    view.setOnReceiveContentListener(arrayOf("image/*", "video/*", "audio/*", "application/*")) { _, payload ->
      val split = payload.partition { item -> item.uri != null }
      val taken = split.first ?: return@setOnReceiveContentListener payload
      val uris = (0 until taken.clip.itemCount).mapNotNull { taken.clip.getItemAt(it).uri }
      Thread { report(uris.take(10)) }.start()
      // What is left (text) pastes as usual.
      split.second
    }
  }

  private fun report(uris: List<Uri>) {
    val context = appContext.reactContext ?: return
    val resolver = context.contentResolver
    val files = uris.mapIndexedNotNull { index, uri ->
      try {
        val type = resolver.getType(uri) ?: "application/octet-stream"
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(type)?.let { ".$it" } ?: ""
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
          if (it.moveToFirst()) it.getString(0) else null
        } ?: "pasted-${System.currentTimeMillis()}-${index + 1}$extension"
        val folder = File(context.cacheDir, "ramu-paste-${UUID.randomUUID()}").apply { mkdirs() }
        val target = File(folder, name.replace('/', '_'))
        var size = 0L
        resolver.openInputStream(uri)?.use { input ->
          target.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              size += read
              // The attachment limit: a larger item is reported without its copy so the composer can say why.
              if (size > MAX_BYTES) break
              output.write(buffer, 0, read)
            }
          }
        } ?: return@mapIndexedNotNull null
        if (size > MAX_BYTES) {
          target.delete()
          mapOf("uri" to "", "name" to name, "mimeType" to type, "size" to size.toDouble())
        } else {
          mapOf("uri" to Uri.fromFile(target).toString(), "name" to name, "mimeType" to type, "size" to size.toDouble())
        }
      } catch (_: Exception) {
        null
      }
    }
    if (files.isNotEmpty()) sendEvent("onPaste", mapOf("files" to files))
  }

  private companion object {
    const val MAX_BYTES = 10_000_000L
  }
}
