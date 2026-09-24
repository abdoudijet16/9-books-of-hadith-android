package com.hadithexplorer

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.textZoom = 100
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.allowFileAccess = true
        }
        setContentView(webView)

        // Opening hadiths.db means copying it out of assets on first
        // launch (see HadithApi.openDatabase) — do that off the UI
        // thread so a big database doesn't freeze the first launch.
        thread {
            val api = HadithApi(applicationContext)
            runOnUiThread {
                webView.addJavascriptInterface(api, "Android")
                webView.loadUrl("file:///android_asset/web/index.html")
            }
        }

        // Hardware/gesture back: go back through in-app screen history
        // (handled in JS) before falling back to leaving the app.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // evaluateJavascript's callback receives a JSON-encoded
                // result, so a JS string "true" arrives here as the
                // 4-character literal "true" (with quotes) — compare
                // against that, not the unquoted word.
                webView.evaluateJavascript(
                    "window.handleNativeBack ? window.handleNativeBack() : 'false'",
                    { result ->
                        if (result != "\"true\"") {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                            isEnabled = true
                        }
                    }
                )
            }
        })
    }
}
