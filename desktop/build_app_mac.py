"""
Builds what people download from fluxdev.org/download on a Mac: "D&D Companion.app" (app.py: a small window onto the live site, no
server or data folders) inside a standard drag-to-Applications disk image.

Setup (once, on a Mac):
    python3 -m pip install -r desktop/requirements-desktop.txt -r desktop/requirements-build.txt
Build:
    python3 desktop/build_app_mac.py [--intel] [--publish <folder>]

Apple Silicon is the default (DnD-Companion-Installer-<version>-macos.dmg). --intel builds the Intel one
(...-macos-intel.dmg); on an Apple Silicon Mac it re-runs itself under Rosetta (`arch -x86_64`), which needs a universal2 Python
(the python.org installer is) and Rosetta installed.

Steps: draw icon.icns from desktop/icon.png, build the .app with PyInstaller (--windowed --onedir), ad-hoc sign it, then wrap it in a
.dmg with hdiutil. Result: dist-app/DnD-Companion-Installer-<version>-macos.dmg (the name server.py's download route expects; people
receive it as "D&D Companion Installer.dmg"). The version is desktop/VERSION. --publish copies the disk image into that folder (the
server's downloads folder: PKDND_DOWNLOAD_DIR). Deploys never touch it.

The app is only ad-hoc signed (no Apple Developer ID), so the first launch needs right-click -> Open. A DMG downloaded from a browser
carries the quarantine flag; with a Developer ID you would also run `xcrun notarytool` and `xcrun stapler` on the .dmg.

The scratch folder is a temp dir, not build-app/, so the build is fast even when the repo is on a synced drive.
"""
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "dist-app"
APP_NAME = "D&D Companion"                   # shown in Finder and the Dock; the .app bundle may contain "&"
EXE_NAME = "DnD Companion"                   # the PyInstaller name (no "&" in anything PyInstaller writes)
BUNDLE_ID = "org.fluxdev.dnd-companion"


def make_icns(work):
    """desktop/icon.png (the d20) -> icon.icns via sips and iconutil (both ship with macOS)."""
    from PIL import Image
    src = Image.open(HERE / "icon.png").convert("RGBA")
    iconset = work / "icon.iconset"
    iconset.mkdir(parents=True)
    for size in (16, 32, 128, 256, 512):
        src.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        src.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
    icns = work / "icon.icns"
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
    return icns


def main():
    if sys.platform != "darwin":
        sys.exit("This builds the Mac disk image, so it has to run on a Mac. (Windows: desktop/build_app.py.)")
    try:
        import PyInstaller  # noqa: F401
        import PIL  # noqa: F401
        import webview  # noqa: F401
    except ImportError:
        sys.exit("pywebview, PyInstaller and Pillow are needed. Run:\n"
                 "    python3 -m pip install -r desktop/requirements-desktop.txt -r desktop/requirements-build.txt")
    intel = "--intel" in sys.argv
    if intel and platform.machine() != "x86_64":
        os.execvp("arch", ["arch", "-x86_64", sys.executable] + sys.argv)   # (replaces this process: the build runs as Intel)
    version = (HERE / "VERSION").read_text(encoding="utf-8").strip()
    work = Path(tempfile.mkdtemp(prefix="dnd-companion-build-"))
    try:
        icns = make_icns(work)

        print("1/3  the app")
        subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--onedir",
                        "--workpath", str(work / "pyi"), "--specpath", str(work), "--distpath", str(work / "app"),
                        "--name", EXE_NAME, "--paths", str(HERE), "--icon", str(icns),
                        "--osx-bundle-identifier", BUNDLE_ID,
                        "--add-data", f"{HERE / 'VERSION'}{os.pathsep}.", str(HERE / "app.py")], check=True)
        built = work / "app" / f"{EXE_NAME}.app"
        app = work / "stage" / f"{APP_NAME}.app"
        (work / "stage").mkdir()
        shutil.copytree(built, app, symlinks=True)
        plist = app / "Contents" / "Info.plist"
        for key, value in (("CFBundleName", APP_NAME), ("CFBundleDisplayName", APP_NAME), ("CFBundleShortVersionString", version),
                           ("CFBundleVersion", version), ("LSMinimumSystemVersion", "10.13")):
            # Set replaces an existing key; Add creates it (PlistBuddy errors on the wrong one, so try both)
            if subprocess.run(["/usr/libexec/PlistBuddy", "-c", f"Set :{key} {value}", str(plist)], capture_output=True).returncode:
                subprocess.run(["/usr/libexec/PlistBuddy", "-c", f"Add :{key} string {value}", str(plist)], check=True)
        # (an unsigned arm64 app won't launch at all; ad-hoc signing is the minimum)
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app)], check=True)

        print("2/3  the disk image")
        os.symlink("/Applications", work / "stage" / "Applications")
        OUT.mkdir(parents=True, exist_ok=True)
        final = OUT / f"DnD-Companion-Installer-{version}-{'macos-intel' if intel else 'macos'}.dmg"
        if final.exists():
            final.unlink()
        subprocess.run(["hdiutil", "create", "-volname", APP_NAME, "-srcfolder", str(work / "stage"), "-ov", "-format", "UDZO",
                        str(final)], check=True)
        print(f"3/3  built {final} ({final.stat().st_size / 1e6:.1f} MB)")

        if "--publish" in sys.argv:
            dest = Path(sys.argv[sys.argv.index("--publish") + 1])
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(final, dest / final.name)
            print(f"Published to {dest}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
