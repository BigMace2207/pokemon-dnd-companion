"""
Builds the desktop app (see desktop.py) into a real double-clickable
Windows/Mac app with PyInstaller -- no separate Python install needed on
the machine that runs it.

Setup (once):
    python -m pip install -r requirements-build.txt

Build (on Windows, produces a Windows app; on Mac, produces a Mac app --
PyInstaller only cross-compiles for the OS it's actually running on, so a
Mac build has to be run on a Mac):
    python build_desktop.py

Result: dist/Pokemon D&D Companion/ -- hand the whole folder to whoever's
running the campaign, they run the .exe (Windows) or .app (Mac) inside it.
That folder mode (rather than a single .exe) is deliberate: server.py's
autosave file lives in a proper per-user data folder when frozen (see
_data_dir() in server.py), but the *content* folders a DM manages by hand
-- sfx/ for Sound Effects, sprites/backgrounds/ for battle backgrounds --
still live right next to the built app, exactly like they do when running
from source, so dropping in an mp3 or a background image works the same
way either way.

NOTE: a Windows build and a Mac build are two separate, unrelated .exe/.app
files -- there's no way for them to share one save file, since each is its
own binary with its own per-user data folder. If you want the SAME save
data on both a PC and a Mac (e.g. keeping the app in a synced Google
Drive/Dropbox folder), don't use this build at all -- run the app from
source instead (`python desktop.py`, see README.md's "Sharing save data
between machines" section), which saves right next to itself wherever that
source folder happens to live.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SEP = ";" if sys.platform == "win32" else ":"

APP_NAME = "Pokemon D&D Companion"

# Everything the running app reads off disk at startup -- bundled in
# read-only, right alongside the exe/app, same layout as running from
# source. (The autosave file is NOT here on purpose -- see server.py's
# _data_dir().)
DATA_DIRS = ["css", "js", "data", "sprites", "sfx", "assets"]
DATA_FILES = ["index.html"]


def make_icon():
    """Best-effort .ico (Windows) / .icns (Mac) from assets/logo.png, so
    the built app doesn't ship with PyInstaller's default icon. Skipped
    silently if Pillow isn't installed or the conversion fails -- a
    missing custom icon isn't worth failing the whole build over."""
    logo = ROOT / "assets" / "logo.png"
    if not logo.exists():
        return None
    try:
        from PIL import Image
        img = Image.open(logo).convert("RGBA")
        if sys.platform == "win32":
            out = ROOT / "assets" / "app.ico"
            img.save(out, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
            return str(out)
        elif sys.platform == "darwin":
            out = ROOT / "assets" / "app.icns"
            img.save(out, format="ICNS")
            return str(out)
    except Exception as e:
        print(f"(skipping custom icon: {e})")
    return None


def main():
    try:
        import PyInstaller.__main__
    except ImportError:
        print("PyInstaller isn't installed. Run:\n    python -m pip install -r desktop/requirements-build.txt")
        sys.exit(1)

    for name in DATA_DIRS:
        if not (ROOT / name).exists():
            print(f"Warning: expected folder '{name}' not found next to build_desktop.py -- continuing without it.")
    for name in DATA_FILES:
        if not (ROOT / name).exists():
            print(f"Warning: expected file '{name}' not found next to build_desktop.py -- continuing without it.")

    args = [
        str(HERE / "desktop.py"),
        "--name", APP_NAME,
        "--onedir",
        "--windowed",       # no console window behind the app
        "--noconfirm",      # overwrite a previous build without asking
        "--clean",
    ]
    icon = make_icon()
    if icon:
        args += ["--icon", icon]
    for name in DATA_DIRS:
        if (ROOT / name).exists():
            args += ["--add-data", f"{ROOT / name}{SEP}{name}"]
    for name in DATA_FILES:
        if (ROOT / name).exists():
            args += ["--add-data", f"{ROOT / name}{SEP}."]

    print("Running PyInstaller...")
    PyInstaller.__main__.run(args)

    dist_dir = ROOT / "dist" / APP_NAME
    print()
    print("=" * 56)
    print(f"  Built: {dist_dir}")
    print("  Hand that whole folder to whoever's running the game --")
    print("  the app is the .exe (Windows) or .app (Mac) inside it.")
    print("=" * 56)


if __name__ == "__main__":
    main()
