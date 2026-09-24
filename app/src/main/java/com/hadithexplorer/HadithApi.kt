package com.hadithexplorer

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Ported from the desktop hadith_app.py `Api` class. Same schema
 * (books / chapters / hadiths), same Arabic-diacritic normalization
 * for search, same bookmark semantics — just SQLite via the Android
 * framework instead of Python's sqlite3, and JSON strings across the
 * JS bridge instead of native pywebview objects (Android's
 * addJavascriptInterface only marshals primitives/String, not dicts).
 *
 * All public methods are synchronous and safe to call from any thread —
 * Android WebView dispatches @JavascriptInterface calls off the UI
 * thread already, and SQLiteDatabase handles its own internal locking,
 * so (unlike the Windows build) no extra Lock is needed here.
 */
class HadithApi(private val context: Context) {

    private val db: SQLiteDatabase = openDatabase()

    // ---------------------------------------------------------------
    //  Arabic normalization (search only — display keeps diacritics)
    // ---------------------------------------------------------------
    private val tashkeelRegex = Regex(
        "[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]"
    )

    private fun normalizeArabic(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        var t = tashkeelRegex.replace(text, "")
        t = t.replace(Regex("[إأآا]"), "ا")
        return t.replace("ى", "ي").replace("ة", "ه")
            .replace("ؤ", "و").replace("ئ", "ي")
    }

    // ---------------------------------------------------------------
    //  First-run setup: copy the read-only bundled DB out of the APK's
    //  assets into a writable location, then add a `bookmarks` table
    //  to that same file if it isn't there yet (no ATTACH DATABASE
    //  needed like on desktop — one file is simpler on Android).
    // ---------------------------------------------------------------
    private fun openDatabase(): SQLiteDatabase {
        val dbFile = File(context.filesDir, "hadiths.db")
        if (!dbFile.exists() || dbFile.length() < 10_000) {
            context.assets.open("hadiths.db").use { input ->
                FileOutputStream(dbFile).use { output ->
                    input.copyTo(output, bufferSize = 1 shl 20)
                }
            }
        }
        val database = SQLiteDatabase.openDatabase(
            dbFile.absolutePath, null, SQLiteDatabase.OPEN_READWRITE
        )
        database.execSQL(
            "CREATE TABLE IF NOT EXISTS bookmarks (" +
                "hadith_id INTEGER PRIMARY KEY, " +
                "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        return database
    }

    // ---------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------
    private fun Cursor.toJsonArray(): JSONArray {
        val arr = JSONArray()
        while (moveToNext()) {
            val obj = JSONObject()
            for (i in 0 until columnCount) {
                val name = getColumnName(i)
                when (getType(i)) {
                    Cursor.FIELD_TYPE_INTEGER -> obj.put(name, getLong(i))
                    Cursor.FIELD_TYPE_FLOAT -> obj.put(name, getDouble(i))
                    Cursor.FIELD_TYPE_NULL -> obj.put(name, JSONObject.NULL)
                    else -> obj.put(name, getString(i))
                }
            }
            arr.put(obj)
        }
        close()
        return arr
    }

    private fun isBookmarked(hadithId: Long): Boolean {
        val c = db.rawQuery("SELECT 1 FROM bookmarks WHERE hadith_id=?", arrayOf(hadithId.toString()))
        val found = c.moveToFirst()
        c.close()
        return found
    }

    // ---------------------------------------------------------------
    //  books / chapters
    // ---------------------------------------------------------------
    @JavascriptInterface
    fun getBooks(): String {
        val c = db.rawQuery(
            "SELECT id, slug, title_ar, title_en, author_ar, author_en FROM books ORDER BY sort_order",
            null
        )
        return c.toJsonArray().toString()
    }

    @JavascriptInterface
    fun getChapters(bookId: Int): String {
        val c = db.rawQuery(
            "SELECT id, number, title_ar, title_en FROM chapters WHERE book_id=? ORDER BY number",
            arrayOf(bookId.toString())
        )
        return c.toJsonArray().toString()
    }

    @JavascriptInterface
    fun getChapterHadiths(bookId: Int, chapterNumber: Int): String {
        val c = db.rawQuery(
            "SELECT id, number_in_book, text_ar, text_en FROM hadiths " +
                "WHERE book_id=? AND chapter_number=? ORDER BY number_in_book",
            arrayOf(bookId.toString(), chapterNumber.toString())
        )
        val arr = c.toJsonArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            o.put("is_bookmarked", isBookmarked(o.getLong("id")))
        }
        return arr.toString()
    }

    // ---------------------------------------------------------------
    //  hadith detail / random
    // ---------------------------------------------------------------
    @JavascriptInterface
    fun getHadith(hadithId: Int): String {
        val c = db.rawQuery(
            "SELECT h.*, b.title_ar AS book_ar, b.title_en AS book_en, " +
                "c.title_ar AS chap_ar, c.title_en AS chap_en " +
                "FROM hadiths h JOIN books b ON b.id = h.book_id " +
                "LEFT JOIN chapters c ON c.book_id = h.book_id AND c.number = h.chapter_number " +
                "WHERE h.id=?",
            arrayOf(hadithId.toString())
        )
        val arr = c.toJsonArray()
        if (arr.length() == 0) return "null"
        val obj = arr.getJSONObject(0)
        obj.put("is_bookmarked", isBookmarked(hadithId.toLong()))
        return obj.toString()
    }

    @JavascriptInterface
    fun randomHadith(): String {
        val c = db.rawQuery("SELECT id FROM hadiths ORDER BY RANDOM() LIMIT 1", null)
        val id = if (c.moveToFirst()) c.getLong(0) else -1L
        c.close()
        return id.toString()
    }

    @JavascriptInterface
    fun stats(): String {
        val c = db.rawQuery("SELECT COUNT(*) FROM hadiths", null)
        c.moveToFirst()
        val n = c.getInt(0)
        c.close()
        return JSONObject().put("hadith_count", n).toString()
    }

    // ---------------------------------------------------------------
    //  unified search: keyword text, hadith number, narrator/sanad,
    //  book author, optionally scoped to one book. All filters are
    //  optional and AND together. `filtersJson` looks like:
    //  {"query":"","narrator":"","author":"","book_id":null,
    //   "number":null,"num_from":null,"num_to":null,"limit":300}
    // ---------------------------------------------------------------
    @JavascriptInterface
    fun search(filtersJson: String): String {
        val f = JSONObject(filtersJson)
        val clauses = mutableListOf<String>()
        val params = mutableListOf<String>()

        val query = f.optString("query", "").trim()
        if (query.isNotEmpty()) {
            clauses.add("(h.text_ar_norm LIKE ? OR h.text_en LIKE ? OR h.narrator_en LIKE ?)")
            val qNorm = normalizeArabic(query)
            params.add("%$qNorm%"); params.add("%$query%"); params.add("%$query%")
        }
        val narrator = f.optString("narrator", "").trim()
        if (narrator.isNotEmpty()) {
            clauses.add("h.narrator_en LIKE ?")
            params.add("%$narrator%")
        }
        val author = f.optString("author", "").trim()
        if (author.isNotEmpty()) {
            clauses.add("(b.author_ar LIKE ? OR b.author_en LIKE ?)")
            params.add("%$author%"); params.add("%$author%")
        }
        if (!f.isNull("book_id")) {
            clauses.add("h.book_id = ?")
            params.add(f.getInt("book_id").toString())
        }
        if (!f.isNull("number")) {
            clauses.add("h.number_in_book = ?")
            params.add(f.getInt("number").toString())
        }
        if (!f.isNull("num_from")) {
            clauses.add("h.number_in_book >= ?")
            params.add(f.getInt("num_from").toString())
        }
        if (!f.isNull("num_to")) {
            clauses.add("h.number_in_book <= ?")
            params.add(f.getInt("num_to").toString())
        }
        if (clauses.isEmpty()) return "[]"

        val limit = if (f.has("limit")) f.getInt("limit") else 300
        val sql = "SELECT h.id, h.number_in_book, h.text_ar, h.text_en, h.narrator_en, " +
            "b.title_ar AS book_ar, b.title_en AS book_en " +
            "FROM hadiths h JOIN books b ON b.id = h.book_id " +
            "WHERE ${clauses.joinToString(" AND ")} " +
            "ORDER BY b.sort_order, h.number_in_book LIMIT ?"
        params.add(limit.toString())

        val c = db.rawQuery(sql, params.toTypedArray())
        val arr = c.toJsonArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            o.put("is_bookmarked", isBookmarked(o.getLong("id")))
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun chapterFilter(query: String): String {
        val q = query.trim()
        if (q.isEmpty()) return "[]"
        val c = db.rawQuery(
            "SELECT c.id, c.number, c.title_ar, c.title_en, c.book_id, " +
                "b.title_ar AS bar, b.title_en AS ben " +
                "FROM chapters c JOIN books b ON b.id = c.book_id " +
                "WHERE c.title_ar LIKE ? OR c.title_en LIKE ? OR b.title_ar LIKE ? OR b.title_en LIKE ? " +
                "ORDER BY b.sort_order, c.number LIMIT 300",
            arrayOf("%$q%", "%$q%", "%$q%", "%$q%")
        )
        return c.toJsonArray().toString()
    }

    // ---------------------------------------------------------------
    //  bookmarks / favorites
    // ---------------------------------------------------------------
    @JavascriptInterface
    fun listBookmarks(): String {
        val c = db.rawQuery(
            "SELECT bm.hadith_id AS hadith_id, h.number_in_book, h.text_ar, h.text_en, " +
                "b.title_ar AS book_ar, b.title_en AS book_en " +
                "FROM bookmarks bm JOIN hadiths h ON h.id = bm.hadith_id " +
                "JOIN books b ON b.id = h.book_id ORDER BY bm.created_at DESC",
            null
        )
        return c.toJsonArray().toString()
    }

    @JavascriptInterface
    fun toggleBookmark(hadithId: Int): String {
        val exists = isBookmarked(hadithId.toLong())
        if (exists) {
            db.execSQL("DELETE FROM bookmarks WHERE hadith_id=?", arrayOf<Any>(hadithId))
        } else {
            db.execSQL("INSERT INTO bookmarks (hadith_id) VALUES (?)", arrayOf<Any>(hadithId))
        }
        return JSONObject().put("bookmarked", !exists).toString()
    }
}
