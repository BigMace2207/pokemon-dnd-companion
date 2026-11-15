"""
The companion app you download from fluxdev.org/download: a window of its own onto the live site. It does not serve anything itself
(unlike desktop.py, the self-hosted version that bundles the whole server), so it is small, and it is always the current version of the
site: there is nothing to update. Sign-in, campaigns and characters are the website's own, the same on every device.

Run from source:    python desktop/app.py
Point it elsewhere: set PKDND_URL (for example http://localhost:8860 for a test server) before running.
Build the download: python desktop/build_app.py   (see that file)
"""
import os
import sys
from pathlib import Path

import shell

SITE_URL = os.environ.get("PKDND_URL") or "https://fluxdev.org"
TITLE = "Pokémon D&D Companion"


def data_dir():
    """Where the app keeps its own small preferences and the window's browser profile: a proper per-user folder, never the app's own."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home())
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "Pokemon D&D Companion App"


def version():
    """The number in desktop/VERSION (bundled next to the app when built)."""
    here = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    try:
        return (here / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "dev"


def main():
    shell.run(SITE_URL, TITLE, data_dir(), version())


if __name__ == "__main__":
    main()
