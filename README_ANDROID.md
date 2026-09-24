# Hadith Explorer — Android port

This is a native Android app (Kotlin + WebView), not a repackage of the
Windows exe — `pywebview` doesn't run on Android, so the desktop
Python `Api` class was ported to Kotlin (`HadithApi.kt`) and the UI was
rebuilt for a phone screen. Same offline SQLite data, same idea: a
WebView renders the UI, a JS bridge (`window.Android.*` instead of
`window.pywebview.api.*`) talks to SQLite.

## What's different from the Windows version

1. **Interface redesigned for phones**, in the spirit of apps like
   Dorar: a single scrollable screen at a time (books → chapters →
   hadith list → hadith), a fixed bottom tab bar with **Books / Search
   / Favorites**, a top app bar with a back arrow, and a bottom sheet
   for the theme picker instead of a toolbar full of controls. RTL
   Arabic-first layout throughout. Hardware/gesture back navigates the
   in-app screen stack before leaving the app (`MainActivity.kt`).

2. **Favorites**: every hadith row — in a chapter list, search
   results, or the reader — has a ☆/★ button that toggles instantly,
   no need to open the hadith first. A dedicated **Favorites** tab
   lists them all, newest first, same as the old bookmarks sidebar.

3. **Search** (`HadithApi.search`) is one combined query covering, all
   optional and AND'ed together: free-text keywords (Arabic-normalized
   the same way as desktop, plus English), an exact hadith number, the
   narrator field (closest thing this dataset has to a sanad/chain —
   see the note below), the book's author, and an optional single-book
   scope. It's plain SQL `LIKE`, not FTS5 — see
   `prepare_db_for_android.py` for why.

## Project layout

```
HadithExplorerAndroid/
  app/src/main/
    java/com/hadithexplorer/
      MainActivity.kt      WebView host, JS bridge wiring, back button
      HadithApi.kt         ported Api class — SQLite + JSON over the bridge
    assets/
      web/                 the mobile UI (index.html, app.js, styles.css, themes/)
      fonts/               Amiri-Regular.ttf, Amiri-Bold.ttf (already copied in)
      hadiths.db           ← YOU NEED TO ADD THIS, see below
    res/                   app icon (converted from your icon.ico), strings, theme
    AndroidManifest.xml
  app/build.gradle
  build.gradle / settings.gradle / gradle.properties
prepare_db_for_android.py  helper to shrink+copy your existing hadiths.db
```

## Before you build: add the database

This environment has no network access and no Android SDK, so it
can't run Gradle or produce an APK — you'll build it in Android Studio,
which you're already set up for since you built the Windows version.

You already have a built `hadiths.db` (40,943 hadiths) from the
Windows project. Reuse it — don't regenerate from the JSON:

```bash
python prepare_db_for_android.py path/to/your/hadiths.db HadithExplorerAndroid/app/src/main/assets/hadiths.db
```

This copies it in and drops the `hadiths_fts` virtual table (Android
here searches with `LIKE`, not FTS5, so that index is just dead
weight in the APK — dropping it and running `VACUUM` shrinks the file).
If you'd rather keep it byte-for-byte identical, just copy
`hadiths.db` straight into `app/src/main/assets/hadiths.db` yourself —
the app works either way, the FTS table is simply unused.

## Building

1. Open the `HadithExplorerAndroid/` folder in Android Studio.
2. If it asks to create/upgrade the Gradle wrapper, let it — this
   project ships `build.gradle`/`settings.gradle` but not the wrapper
   jar (that's a binary download; Android Studio fetches it on sync).
3. Run on a device/emulator, or **Build > Generate Signed Bundle / APK**
   for a release APK to install elsewhere.
4. First launch copies `hadiths.db` out of the APK's assets into app
   storage (a few hundred ms to a couple seconds depending on the
   device — it's a one-time plain file copy, no unzip/rebuild step
   like the Windows splash screen). Every launch after that is
   instant.

No internet permission is requested or needed — everything is the
bundled database, same as the Windows app.

## Notes / things worth knowing

- **"Sanad" search**: this dataset (`AhmedBaset/hadith-json`, same
  source as the Windows build) only has an *English narrator* field
  per hadith (`narrator_en`) — there's no separate chain-of-narrators
  (isnad) field to search, in Arabic or English. The search screen's
  "الراوي / السند" field searches `narrator_en`, same limitation the
  Windows app already had for its narrator filter.
- minSdk 23 (Android 6.0+), no Gradle dependencies beyond AndroidX
  core/appcompat — nothing that needs Play Services or extra native
  libraries.
- The theme CSS files (`mushaf.css`, `dark.css`, `sepia.css`,
  `contrast.css`) are your originals, unchanged — only the page layout
  around them (`styles.css`) was rebuilt for a phone screen.
