#!/usr/bin/env python3
"""
Run this on your Windows machine (where hadiths.db from the desktop
build already exists) to produce the copy that goes into the Android
project.

The Android app searches with plain SQL LIKE (see HadithApi.kt) rather
than FTS5, both because bundled-SQLite FTS5 support varies across
Android versions/devices, and because it lets one query cover keyword
text + narrator + author in a single WHERE clause. The `hadiths_fts`
virtual table and its shadow tables are dead weight for Android, so
this drops them and VACUUMs — usually shaving a meaningful chunk off
the file before it goes into assets/ and gets baked into the APK.

Usage:
    python prepare_db_for_android.py hadiths.db HadithExplorerAndroid/app/src/main/assets/hadiths.db
"""
import shutil
import sqlite3
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)

    conn = sqlite3.connect(str(dst))
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table') "
        "AND name LIKE 'hadiths_fts%'"
    )]
    for t in tables:
        conn.execute(f"DROP TABLE IF EXISTS {t}")
    conn.execute("VACUUM")
    conn.commit()
    conn.close()

    print(f"Wrote {dst} ({dst.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
