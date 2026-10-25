package com.storyflow.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.Html
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.Button
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.ByteArrayInputStream
import java.io.StringReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class MainActivity : AppCompatActivity() {

    private val COMPOSER_URL = "https://business.facebook.com/latest/story_composer/"
    private val LOGIN_URL = "https://business.facebook.com/"

    private val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    private var defaultMobileUa: String = ""

    private val DESKTOP_W = 1440
    private val DESKTOP_H = 1200
    private val DRAG_STEP_MS = 16L

    private lateinit var rootLayout: FrameLayout
    private lateinit var studioWebView: WebView
    private lateinit var metaContainer: FrameLayout
    private lateinit var metaWebView: WebView
    private lateinit var btnCloseMeta: Button

    private lateinit var engine: EngineManager
    private val studioHost by lazy { Uri.parse(getString(R.string.studio_url)).host ?: "" }

    @Volatile private var sfStateJson: String = "null"
    @Volatile private var queueRunning: Boolean = false
    // URL corrente della vista Meta: il ponte del motore risponde solo su business.facebook.com.
    @Volatile private var metaUrl: String = ""
    private val watchdogHandler = Handler(Looper.getMainLooper())

    // Onboarding: scelta ("pick") o verifica ("verify") del nome della pagina nella pagina delle storie
    // di Meta, con assets/meta-setup.js. Mai insieme a una coda di pubblicazione.
    @Volatile private var setupMode: String? = null
    private var setupText: String = ""
    private var setupInjected = false
    private val setupTimeout = Runnable { finishSetup(JSONObject().put("ok", false).put("reason", "timeout")) }
    private val setupLoginCheck = Runnable {
        val url = metaWebView.url ?: ""
        if (setupMode != null && !setupInjected && !url.contains("business.facebook.com/latest/story_composer")) {
            // Meta ha mandato al login: lasciamo la vista Meta aperta per accedere.
            setMetaMobileLoginMode()
            metaContainer.bringToFront()
            rootLayout.requestLayout()
            finishSetup(JSONObject().put("ok", false).put("reason", "login"))
        }
    }

    private val watchdogRunnable = object : Runnable {
        override fun run() {
            if (queueRunning) {
                val url = metaWebView.url ?: ""
                if (url.contains("business.facebook.com/latest/story_composer")) {
                    injectComposerScript()
                }
                watchdogHandler.postDelayed(this, 2000)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        engine = EngineManager(this, getString(R.string.engine_manifest_url), getString(R.string.engine_public_key))
        Thread { engine.checkForUpdate() }.start()

        rootLayout = FrameLayout(this)

        // 1. CONTENITORE META
        metaContainer = FrameLayout(this).apply {
            visibility = View.VISIBLE
            setBackgroundColor(Color.parseColor("#18191a"))
        }

        metaWebView = WebView(this).apply {
            defaultMobileUa = settings.userAgentString
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.mediaPlaybackRequiresUserGesture = false

            webChromeClient = object : WebChromeClient() {
                override fun onJsBeforeUnload(v: WebView?, u: String?, m: String?, res: JsResult?): Boolean {
                    res?.confirm()
                    return true
                }
                override fun onJsConfirm(v: WebView?, u: String?, m: String?, res: JsResult?): Boolean {
                    res?.confirm()
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    metaUrl = url ?: ""
                    // La pagina è cambiata dopo l'avvio della scelta: lo script iniettato non risponderà più.
                    if (setupMode != null && setupInjected) {
                        finishSetup(JSONObject().put("ok", false).put("reason", "navigated"))
                    }
                }
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    metaUrl = url ?: ""
                    if (queueRunning && url != null && url.contains("business.facebook.com/latest/story_composer")) {
                        injectComposerScript()
                    }
                    if (setupMode != null && !setupInjected) {
                        if (url != null && url.contains("business.facebook.com/latest/story_composer")) {
                            injectSetupScript()
                        } else {
                            watchdogHandler.removeCallbacks(setupLoginCheck)
                            watchdogHandler.postDelayed(setupLoginCheck, 3000)
                        }
                    }
                }
            }
            addJavascriptInterface(MetaBridge(), "StoryFlowNative")
        }

        btnCloseMeta = Button(this).apply {
            text = "✓ Torna a StoryFlow Studio"
            setBackgroundColor(Color.parseColor("#6045e8"))
            setTextColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply { setMargins(24, 36, 24, 24) }
            setOnClickListener {
                studioWebView.bringToFront()
                rootLayout.requestLayout()
            }
        }

        metaContainer.addView(metaWebView)
        metaContainer.addView(btnCloseMeta)

        // 2. DASHBOARD STORYFLOW STUDIO
        studioWebView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            webChromeClient = WebChromeClient()

            webViewClient = object : WebViewClient() {
                // Il pannello resta sul proprio dominio: gli altri link si aprono nel browser.
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return false
                    if (uri.host == studioHost || uri.host == "storyflow.local") return false
                    if (uri.scheme == "http" || uri.scheme == "https") {
                        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) {}
                    }
                    return true
                }

                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    val path = uri.path ?: ""

                    if (path.endsWith("/proxy.php") || path == "proxy.php") {
                        val action = uri.getQueryParameter("action") ?: ""
                        if (action == "feed") {
                            val site = uri.getQueryParameter("site") ?: ""
                            val limit = (uri.getQueryParameter("n")?.toIntOrNull() ?: 20).coerceIn(1, 30)
                            return handleNativeFeed(site, limit)
                        }
                        if (action == "img") {
                            val imgUrl = uri.getQueryParameter("url") ?: ""
                            return handleNativeImage(imgUrl)
                        }
                    }

                    if (uri.host == "storyflow.local") {
                        val cleanName = path.trimStart('/').ifEmpty { "index.html" }
                        val mime = when {
                            cleanName.endsWith(".html") -> "text/html"
                            cleanName.endsWith(".css") -> "text/css"
                            cleanName.endsWith(".js") -> "application/javascript"
                            else -> "application/octet-stream"
                        }
                        return try {
                            WebResourceResponse(mime, "UTF-8", assets.open(cleanName))
                        } catch (e: Exception) {
                            null
                        }
                    }
                    return super.shouldInterceptRequest(view, request)
                }
            }
            addJavascriptInterface(StudioBridge(), "StoryFlowNative")
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(metaWebView, true)

        rootLayout.addView(metaContainer)
        rootLayout.addView(studioWebView)
        setContentView(rootLayout)

        studioWebView.loadUrl(getString(R.string.studio_url))
    }

    private fun setMetaMobileLoginMode() {
        metaWebView.settings.userAgentString = defaultMobileUa
        metaWebView.setInitialScale(0)
        metaWebView.scaleX = 1f
        metaWebView.scaleY = 1f
        metaWebView.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        )
        metaWebView.requestLayout()
    }

    private fun setMetaDesktopComposerMode() {
        metaWebView.settings.userAgentString = DESKTOP_UA
        metaWebView.setInitialScale(100)
        metaWebView.layoutParams = FrameLayout.LayoutParams(DESKTOP_W, DESKTOP_H, Gravity.CENTER)

        val screenW = resources.displayMetrics.widthPixels.toFloat()
        val fitScale = (screenW / DESKTOP_W.toFloat()).coerceAtMost(1f)
        metaWebView.scaleX = fitScale
        metaWebView.scaleY = fitScale
        metaWebView.requestLayout()
    }

    private fun loadFreshComposerPage(dryRun: Boolean) {
        setMetaDesktopComposerMode()
        val hash = if (dryRun) "#sftest" else "#sfauto"
        val freshUrl = "${COMPOSER_URL}?sf_ts=${System.currentTimeMillis()}$hash"
        metaWebView.loadUrl(freshUrl)

        watchdogHandler.removeCallbacks(watchdogRunnable)
        watchdogHandler.postDelayed(watchdogRunnable, 2000)
    }

    private fun injectComposerScript() {
        try {
            metaWebView.evaluateJavascript(engine.code(), null)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // --- ONBOARDING: NOME DELLA PAGINA META ---

    private fun startSetup(mode: String, text: String) {
        if (queueRunning || setupMode != null) {
            deliverSetupResult(JSONObject().put("ok", false).put("reason", "busy"))
            return
        }
        setupMode = mode
        setupText = text.take(200)
        setupInjected = false
        setMetaDesktopComposerMode()
        metaWebView.loadUrl("${COMPOSER_URL}?sf_setup=${System.currentTimeMillis()}")
        if (mode == "pick") {
            metaContainer.bringToFront()
            rootLayout.requestLayout()
        }
        watchdogHandler.removeCallbacks(setupTimeout)
        watchdogHandler.postDelayed(setupTimeout, if (mode == "pick") 6 * 60 * 1000L else 60 * 1000L)
    }

    private fun injectSetupScript() {
        val mode = setupMode ?: return
        setupInjected = true
        watchdogHandler.removeCallbacks(setupLoginCheck)
        val code = try {
            assets.open("meta-setup.js").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            finishSetup(JSONObject().put("ok", false).put("reason", "error"))
            return
        }
        // La pagina desktop è rimpicciolita per stare nello schermo: il riquadro della scelta va ingrandito.
        val zoom = (resources.displayMetrics.density / metaWebView.scaleX.coerceAtLeast(0.1f)).coerceIn(1f, 6f)
        val call = if (mode == "pick") "window.__sfMetaSetup.pick({zoom:$zoom})"
            else "window.__sfMetaSetup.verify(${JSONObject.quote(setupText)})"
        metaWebView.evaluateJavascript(
            "$code\n;$call.then(function(r){window.StoryFlowNative.setupResult(JSON.stringify(r));});",
            null
        )
    }

    private fun finishSetup(result: JSONObject) {
        val mode = setupMode ?: return
        setupMode = null
        setupInjected = false
        watchdogHandler.removeCallbacks(setupTimeout)
        watchdogHandler.removeCallbacks(setupLoginCheck)
        if (mode == "pick" && result.optString("reason") != "login") {
            studioWebView.bringToFront()
            rootLayout.requestLayout()
        }
        deliverSetupResult(result)
    }

    private fun deliverSetupResult(result: JSONObject) {
        // Ri-serializzato con i soli campi attesi: al pannello arriva solo JSON valido.
        val safe = JSONObject().apply {
            put("ok", result.optBoolean("ok", false))
            put("reason", result.optString("reason", "").take(30))
            put("text", result.optString("text", "").take(200))
            put("suggestion", result.optString("suggestion", "").take(200))
        }.toString()
        studioWebView.evaluateJavascript(
            "window.__onStoryFlowSetupResult && window.__onStoryFlowSetupResult($safe);",
            null
        )
    }

    // --- MOTORE FEED E IMMAGINI NATIVO (ZERO-CACHE) ---

    private fun httpGetBytes(urlStr: String, timeoutMs: Int = 12000): Pair<Int, ByteArray> {
        var currentUrl = urlStr
        for (hop in 0 until 4) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = true
                useCaches = false
                defaultUseCaches = false
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                setRequestProperty("User-Agent", DESKTOP_UA)
                setRequestProperty("Accept", "application/json, application/rss+xml, application/xml, text/xml, image/*, */*")
                setRequestProperty("Cache-Control", "no-cache, no-store, must-revalidate")
                setRequestProperty("Pragma", "no-cache")
                setRequestProperty("Expires", "0")
            }
            val code = conn.responseCode
            if (code in listOf(301, 302, 303, 307, 308)) {
                val loc = conn.getHeaderField("Location") ?: break
                currentUrl = URL(URL(currentUrl), loc).toString()
                continue
            }
            val bytes = (if (code in 200..299) conn.inputStream else conn.errorStream)?.use { it.readBytes() } ?: ByteArray(0)
            return Pair(code, bytes)
        }
        throw Exception("Troppi reindirizzamenti")
    }

    private fun jsonResponse(status: Int, json: String): WebResourceResponse {
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Cache-Control" to "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma" to "no-cache"
        )
        return WebResourceResponse("application/json", "UTF-8", status, if (status == 200) "OK" else "Error", headers, ByteArrayInputStream(json.toByteArray(Charsets.UTF_8)))
    }

    private fun stripHtml(html: String): String = Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString().trim()

    private fun extractFirstImg(html: String): String {
        val m = Regex("""<img\b[^>]*(?:data-src|src)=['"]([^'"]+)""", RegexOption.IGNORE_CASE).find(html)
        return m?.groupValues?.getOrNull(1) ?: ""
    }

    private fun sha1Short(text: String): String {
        val b = MessageDigest.getInstance("SHA-1").digest(text.toByteArray())
        return b.joinToString("") { "%02x".format(it) }.take(12)
    }

    private fun parseWpJson(raw: String, limit: Int): JSONArray? {
        val arr = JSONArray(raw)
        val out = JSONArray()
        for (i in 0 until minOf(arr.length(), limit)) {
            val p = arr.optJSONObject(i) ?: continue
            val link = p.optString("link", "")
            if (link.isEmpty()) continue
            val title = stripHtml(p.optJSONObject("title")?.optString("rendered") ?: "")
            var image = p.optJSONObject("_embedded")?.optJSONArray("wp:featuredmedia")?.optJSONObject(0)?.optString("source_url", "") ?: ""
            if (image.isEmpty()) image = p.optString("jetpack_featured_media_url", "")
            if (image.isEmpty()) image = extractFirstImg(p.optJSONObject("content")?.optString("rendered") ?: "")
            out.put(JSONObject().apply {
                put("id", p.optInt("id", 0).let { if (it > 0) it.toString() else sha1Short(link) })
                put("title", title)
                put("url", link)
                put("date", p.optString("date", ""))
                put("image", image)
            })
        }
        return if (out.length() > 0) out else null
    }

    private fun parseRssXml(raw: String, limit: Int): JSONArray? {
        val factory = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }
        val parser = factory.newPullParser()
        parser.setInput(StringReader(raw))
        val out = JSONArray()
        var inItem = false; var title = ""; var link = ""; var desc = ""; var img = ""; var date = ""
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT && out.length() < limit) {
            val name = parser.name?.lowercase() ?: ""
            when (event) {
                XmlPullParser.START_TAG -> {
                    if (name == "item" || name == "entry") {
                        inItem = true; title = ""; link = ""; desc = ""; img = ""; date = ""
                    } else if (inItem) {
                        when (name) {
                            "title" -> title = stripHtml(parser.nextText())
                            "link" -> {
                                val href = parser.getAttributeValue(null, "href")
                                val text = parser.nextText().trim()
                                if (link.isEmpty()) link = if (!href.isNullOrEmpty()) href else text
                            }
                            "description", "encoded", "content", "summary" -> desc += parser.nextText()
                            "pubdate", "updated", "published" -> date = parser.nextText().trim()
                            "thumbnail", "enclosure" -> {
                                val u = parser.getAttributeValue(null, "url")
                                if (img.isEmpty() && !u.isNullOrEmpty()) img = u
                            }
                        }
                    }
                }
                XmlPullParser.END_TAG -> {
                    if ((name == "item" || name == "entry") && inItem) {
                        inItem = false
                        if (img.isEmpty()) img = extractFirstImg(desc)
                        if (title.isNotEmpty() && link.isNotEmpty()) {
                            out.put(JSONObject().apply {
                                put("id", sha1Short(link))
                                put("title", title)
                                put("url", link)
                                put("date", date)
                                put("image", img)
                            })
                        }
                    }
                }
            }
            event = parser.next()
        }
        return if (out.length() > 0) out else null
    }

    private fun handleNativeFeed(siteUrl: String, limit: Int): WebResourceResponse {
        return try {
            val u = Uri.parse(siteUrl.trim())
            val origin = "${u.scheme}://${u.host}"
            val path = (u.path ?: "").trimEnd('/')
            val prefix = origin + path

            // Timestamp anti-cache + ordinamento per data decrescente
            val ts = System.currentTimeMillis()
            val wpQuery = "?_embed=1&status=publish&orderby=date&order=desc&per_page=$limit&_t=$ts"

            val candidates = if (path.isNotEmpty()) listOf(
                "wp" to "$prefix/wp-json/wp/v2/posts$wpQuery",
                "rss" to "$prefix/feed/?_t=$ts",
                "wp" to "$origin/wp-json/wp/v2/posts$wpQuery",
                "rss" to "$origin/feed/?_t=$ts"
            ) else listOf(
                "wp" to "$origin/wp-json/wp/v2/posts$wpQuery",
                "wp" to "$origin/?rest_route=/wp/v2/posts&_embed=1&orderby=date&order=desc&per_page=$limit&_t=$ts",
                "rss" to "$origin/feed/?_t=$ts",
                "rss" to "$origin/rss/?_t=$ts"
            )
            for ((type, candidateUrl) in candidates) {
                try {
                    val (code, bytes) = httpGetBytes(candidateUrl, 10000)
                    if (code != 200) continue
                    val body = String(bytes, Charsets.UTF_8).trim()
                    val items = if (type == "wp" && body.startsWith("[")) parseWpJson(body, limit) else parseRssXml(body, limit)
                    if (items != null && items.length() > 0) {
                        return jsonResponse(200, JSONObject().apply {
                            put("items", items); put("source", type); put("feed_url", candidateUrl)
                        }.toString())
                    }
                } catch (_: Exception) {}
            }
            jsonResponse(502, JSONObject().put("error", "Nessun feed pubblico trovato").toString())
        } catch (e: Exception) {
            jsonResponse(400, JSONObject().put("error", "URL non valido: ${e.message}").toString())
        }
    }

    private fun handleNativeImage(imgUrl: String): WebResourceResponse {
        return try {
            val (code, bytes) = httpGetBytes(imgUrl, 15000)
            if (code != 200 || bytes.isEmpty()) throw Exception("HTTP $code")
            val mime = when {
                imgUrl.lowercase().contains(".png") -> "image/png"
                imgUrl.lowercase().contains(".webp") -> "image/webp"
                else -> "image/jpeg"
            }
            val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "public, max-age=3600")
            WebResourceResponse(mime, null, 200, "OK", headers, ByteArrayInputStream(bytes))
        } catch (e: Exception) {
            jsonResponse(502, JSONObject().put("error", "Errore immagine: ${e.message}").toString())
        }
    }

    // --- BRIDGE NATIVO ---
    // Due ponti separati: il pannello (StudioBridge) avvia la coda, la pagina Meta (MetaBridge) la esegue
    // con il motore. Stessa interfaccia window.StoryFlowNative dell'app desktop.

    private fun buildLastReport(): String {
        if (sfStateJson == "null") return "{\"available\":false}"
        val st = JSONObject(sfStateJson)
        return JSONObject().apply {
            put("available", true)
            put("lastError", st.optJSONObject("lastError"))
            put("log", st.optJSONArray("log"))
            put("summary", JSONObject().apply {
                put("ok", st.optInt("ok", 0))
                put("err", st.optInt("err", 0))
                put("total", st.optInt("total", 0))
            })
        }.toString()
    }

    inner class StudioBridge {

        @JavascriptInterface
        fun getPlatform(): String = "android"

        @JavascriptInterface
        fun pickMetaTarget() {
            runOnUiThread { startSetup("pick", "") }
        }

        @JavascriptInterface
        fun verifyMetaTarget(text: String) {
            runOnUiThread { startSetup("verify", text) }
        }

        @JavascriptInterface
        fun cancelMetaSetup() {
            runOnUiThread {
                if (setupMode == null) return@runOnUiThread
                if (setupInjected) {
                    metaWebView.evaluateJavascript("window.__sfMetaSetup && window.__sfMetaSetup.cancel()", null)
                } else {
                    finishSetup(JSONObject().put("ok", false).put("reason", "cancel"))
                }
            }
        }

        @JavascriptInterface
        fun startQueue(payloadJson: String) {
            val obj = try { JSONObject(payloadJson) } catch (_: Exception) { return }
            val items = obj.optJSONArray("items") ?: return
            if (items.length() == 0 || queueRunning || setupMode != null) return
            val dryRun = obj.optBoolean("dryRun", false)
            val reqId = obj.optString("reqId", "sf-" + System.currentTimeMillis())

            sfStateJson = JSONObject().apply {
                put("items", items)
                put("dryRun", dryRun)
                put("done", 0)
                put("ok", 0)
                put("err", 0)
                put("total", items.length())
                put("reqId", reqId)
                put("log", JSONArray())
                put("t", System.currentTimeMillis())
            }.toString()
            queueRunning = true
            // Prima di aprire Meta cerca un motore più recente (al massimo 5 secondi di attesa).
            Thread {
                val checker = Thread { engine.checkForUpdate() }.apply { start() }
                checker.join(5000)
                runOnUiThread { loadFreshComposerPage(dryRun) }
            }.start()
        }

        @JavascriptInterface
        fun isQueueRunning(): Boolean = queueRunning

        @JavascriptInterface
        fun openMetaLogin() {
            runOnUiThread {
                if (!queueRunning) {
                    setMetaMobileLoginMode()
                    val cur = metaWebView.url ?: ""
                    if (!cur.contains("facebook.com")) {
                        metaWebView.loadUrl(LOGIN_URL)
                    }
                }
                metaContainer.bringToFront()
                rootLayout.requestLayout()
            }
        }

        @JavascriptInterface
        fun getLastReport(): String = buildLastReport()

        @JavascriptInterface
        fun getEngineInfo(): String = engine.infoJson()
    }

    inner class MetaBridge {

        private fun allowed(): Boolean = queueRunning && metaUrl.startsWith("https://business.facebook.com/")

        @JavascriptInterface
        fun getPlatform(): String = "android"

        @JavascriptInterface
        fun isQueueRunning(): Boolean = allowed()

        @JavascriptInterface
        fun getState(): String = if (allowed()) sfStateJson else "null"

        @JavascriptInterface
        fun saveState(newStateJson: String) {
            if (!allowed()) return
            sfStateJson = newStateJson
            CookieManager.getInstance().flush()
        }

        @JavascriptInterface
        fun sendProgress(progressJson: String) {
            if (!allowed()) return
            // Ri-serializzato: al pannello arriva solo JSON valido.
            val safeJson = try { JSONObject(progressJson).toString() } catch (_: Exception) { return }
            runOnUiThread {
                studioWebView.evaluateJavascript(
                    "window.__onStoryFlowNativeProgress && window.__onStoryFlowNativeProgress($safeJson);",
                    null
                )
            }
        }

        @JavascriptInterface
        fun trustedClick(x: Double, y: Double, vw: Double, vh: Double) {
            if (!allowed()) return
            runOnUiThread {
                metaWebView.requestFocus()
                val safeVw = if (vw > 0.0) vw.toFloat() else DESKTOP_W.toFloat()
                val safeVh = if (vh > 0.0) vh.toFloat() else DESKTOP_H.toFloat()
                val targetX = (x.toFloat() / safeVw) * metaWebView.width.toFloat()
                val targetY = (y.toFloat() / safeVh) * metaWebView.height.toFloat()

                val downTime = SystemClock.uptimeMillis()
                val downEvent = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, targetX, targetY, 0)
                val upEvent = MotionEvent.obtain(downTime, downTime + 70, MotionEvent.ACTION_UP, targetX, targetY, 0)
                metaWebView.dispatchTouchEvent(downEvent)
                metaWebView.dispatchTouchEvent(upEvent)
                downEvent.recycle()
                upEvent.recycle()
            }
        }

        @JavascriptInterface
        fun trustedDrag(sx: Double, sy: Double, ex: Double, ey: Double, vw: Double, vh: Double) {
            if (!allowed()) return
            runOnUiThread {
                metaWebView.requestFocus()
                val safeVw = if (vw > 0.0) vw.toFloat() else DESKTOP_W.toFloat()
                val safeVh = if (vh > 0.0) vh.toFloat() else DESKTOP_H.toFloat()
                val startX = (sx.toFloat() / safeVw) * metaWebView.width.toFloat()
                val startY = (sy.toFloat() / safeVh) * metaWebView.height.toFloat()
                val endX = (ex.toFloat() / safeVw) * metaWebView.width.toFloat()
                val endY = (ey.toFloat() / safeVh) * metaWebView.height.toFloat()

                val downTime = SystemClock.uptimeMillis()
                val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, startX, startY, 0)
                metaWebView.dispatchTouchEvent(down)
                down.recycle()

                // Un passo ogni DRAG_STEP_MS, come su desktop ed estensione: Chromium e React
                // ricevono il movimento distribuito nel tempo invece che tutto nello stesso frame.
                // Durata totale ~425 ms, entro i 700 ms che il motore attende dopo trustedDrag.
                val steps = 25
                for (i in 1..steps) {
                    metaWebView.postDelayed({
                        val cx = startX + (endX - startX) * i / steps
                        val cy = startY + (endY - startY) * i / steps
                        val move = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, cx, cy, 0)
                        metaWebView.dispatchTouchEvent(move)
                        move.recycle()
                    }, i * DRAG_STEP_MS)
                }
                metaWebView.postDelayed({
                    val up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, endX, endY, 0)
                    metaWebView.dispatchTouchEvent(up)
                    up.recycle()
                }, steps * DRAG_STEP_MS + 25)
            }
        }

        @JavascriptInterface
        fun setupResult(resultJson: String) {
            if (!metaUrl.startsWith("https://business.facebook.com/")) return
            val result = try { JSONObject(resultJson) } catch (_: Exception) { return }
            runOnUiThread { if (setupMode != null) finishSetup(result) }
        }

        @JavascriptInterface
        fun nextStory(dryRun: Boolean) {
            if (!allowed()) return
            runOnUiThread {
                loadFreshComposerPage(dryRun)
            }
        }

        @JavascriptInterface
        fun finishQueue() {
            if (!queueRunning) return
            runOnUiThread {
                queueRunning = false
                watchdogHandler.removeCallbacks(watchdogRunnable)
                studioWebView.bringToFront()
                rootLayout.requestLayout()
                CookieManager.getInstance().flush()
            }
        }
    }
}
