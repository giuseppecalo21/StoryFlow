package com.storyflow.app

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Motore di pubblicazione (composer.js): versione integrata negli asset + aggiornamenti dal server.
 * Un motore scaricato viene usato solo se la firma ECDSA del manifest e lo sha256 del file corrispondono,
 * così una correzione per un cambio dell'interfaccia Meta arriva senza aggiornare l'app.
 */
class EngineManager(
    private val context: Context,
    private val manifestUrl: String,
    private val publicKeyB64: String
) {
    data class Engine(val code: String, val version: String, val source: String)

    companion object {
        const val CLIENT_API = 1
    }

    private val cacheDir = File(context.filesDir, "engine")
    @Volatile private var active: Engine = loadBest()
    @Volatile private var lastError: String = ""
    @Volatile private var lastCheckAt: Long = 0

    fun code(): String = active.code

    fun infoJson(): String = JSONObject()
        .put("version", active.version)
        .put("source", active.source)
        .put("lastCheckAt", lastCheckAt)
        .put("lastError", lastError)
        .toString()

    private fun versionOf(code: String): String =
        Regex("ENGINE_VERSION\\s*=\\s*'([^']+)'").find(code)?.groupValues?.get(1) ?: "0.0.0"

    private fun loadBundled(): Engine {
        val code = context.assets.open("composer.js").bufferedReader().use { it.readText() }
        return Engine(code, versionOf(code), "integrato")
    }

    private fun loadCached(): Engine? = try {
        val manifest = JSONObject(File(cacheDir, "manifest.json").readText())
        val bytes = File(cacheDir, "composer.js").readBytes()
        if (verifyManifest(manifest).isNotEmpty() || sha256(bytes) != manifest.optString("sha256")) null
        else Engine(String(bytes, Charsets.UTF_8), manifest.optString("version"), "remoto")
    } catch (_: Exception) {
        null
    }

    private fun loadBest(): Engine {
        val bundled = loadBundled()
        val cached = loadCached()
        return if (cached != null && compareVersions(cached.version, bundled.version) > 0) cached else bundled
    }

    private fun compareVersions(a: String, b: String): Int {
        val pa = a.split('.').map { it.toIntOrNull() ?: 0 }
        val pb = b.split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = pa.getOrElse(i) { 0 } - pb.getOrElse(i) { 0 }
            if (d != 0) return if (d > 0) 1 else -1
        }
        return 0
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun verifyManifest(m: JSONObject): String {
        if (publicKeyB64.isBlank()) return "chiave pubblica non configurata"
        val signature = m.optString("signature")
        val sha = m.optString("sha256")
        if (signature.isEmpty() || !Regex("^[0-9a-f]{64}$").matches(sha)) return "manifest non firmato"
        val minApi = m.optInt("minClientApi", 1).let { if (it <= 0) 1 else it }
        if (minApi > CLIENT_API) return "motore troppo recente per questa versione dell'app"
        // Stesso testo firmato da tools/engine-sign.mjs e verificato da app desktop ed estensione.
        val message = "storyflow-engine\n${m.optString("version")}\n$sha\n$minApi"
        return try {
            val key = KeyFactory.getInstance("EC")
                .generatePublic(X509EncodedKeySpec(Base64.decode(publicKeyB64, Base64.DEFAULT)))
            val verifier = Signature.getInstance("SHA256withECDSA")
            verifier.initVerify(key)
            verifier.update(message.toByteArray(Charsets.UTF_8))
            if (verifier.verify(p1363ToDer(Base64.decode(signature, Base64.DEFAULT)))) "" else "firma non valida"
        } catch (e: Exception) {
            "verifica firma: ${e.message}"
        }
    }

    /** La firma arriva come r||s (64 byte); Java vuole il formato DER. */
    private fun p1363ToDer(sig: ByteArray): ByteArray {
        require(sig.size == 64) { "firma di lunghezza inattesa" }
        fun derInteger(bytes: ByteArray): ByteArray {
            var i = 0
            while (i < bytes.size - 1 && bytes[i] == 0.toByte()) i++
            var v = bytes.copyOfRange(i, bytes.size)
            if ((v[0].toInt() and 0x80) != 0) v = byteArrayOf(0) + v
            return byteArrayOf(0x02, v.size.toByte()) + v
        }
        val body = derInteger(sig.copyOfRange(0, 32)) + derInteger(sig.copyOfRange(32, 64))
        return byteArrayOf(0x30, body.size.toByte()) + body
    }

    private fun httpGet(urlStr: String): ByteArray {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            useCaches = false
            connectTimeout = 8000
            readTimeout = 10000
            setRequestProperty("Cache-Control", "no-cache")
        }
        try {
            val code = conn.responseCode
            if (code != 200) throw Exception("HTTP $code")
            return conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    }

    /** Scarica una versione più recente se disponibile. Bloccante: chiamare fuori dal thread UI. */
    @Synchronized
    fun checkForUpdate(): Boolean {
        lastCheckAt = System.currentTimeMillis()
        lastError = ""
        return try {
            val sep = if (manifestUrl.contains("?")) "&" else "?"
            val manifest = JSONObject(String(httpGet("$manifestUrl${sep}t=${System.currentTimeMillis()}"), Charsets.UTF_8))
            val problem = verifyManifest(manifest)
            if (problem.isNotEmpty()) throw Exception(problem)
            val version = manifest.optString("version")
            if (compareVersions(version, active.version) <= 0) return false
            val fileUrl = URL(URL(manifestUrl), manifest.optString("file", "composer.js")).toString()
            val bytes = httpGet("$fileUrl?v=$version")
            if (sha256(bytes) != manifest.optString("sha256")) throw Exception("sha256 del motore non corrisponde al manifest")
            cacheDir.mkdirs()
            File(cacheDir, "composer.js").writeBytes(bytes)
            File(cacheDir, "manifest.json").writeText(manifest.toString())
            active = Engine(String(bytes, Charsets.UTF_8), version, "remoto")
            true
        } catch (e: Exception) {
            lastError = e.message ?: e.toString()
            false
        }
    }
}
