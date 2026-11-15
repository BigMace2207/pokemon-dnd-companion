"""
Builds what people download from fluxdev.org/download on Windows: a standard Windows installer wizard ("D&D Companion Installer",
built by Inno Setup from installer.iss) that carries the app (app.py: a small window onto the live site, no server or data folders).

Setup (once):
    python -m pip install -r desktop/requirements-build.txt
    winget install JRSoftware.InnoSetup          (the installer compiler; this script finds ISCC.exe, or set the ISCC environment variable)
Build:
    python desktop/build_app.py [--publish <folder>]

Steps: build the app folder (PyInstaller --onedir), draw the wizard's images from desktop/icon.png, run Inno Setup. Result:
dist-app/DnD-Companion-Installer-<version>-windows.exe (the name server.py's download route expects; people receive it as
"D&D Companion Installer.exe"). The version is desktop/VERSION. --publish copies the installer into that folder (the server's
downloads folder: PKDND_DOWNLOAD_DIR, by default <data dir>/downloads; on the VM ~/pokemon-dnd/downloads). Deploys never touch it.

Windows only for now: PyInstaller builds for the OS it runs on, and a Mac installer (.dmg) would be built on a Mac.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "dist-app"
WORK = ROOT / "build-app"
APP_NAME = "DnD Companion"                   # the app's folder and .exe: no "&" in anything on disk


def find_iscc():
    candidates = [os.environ.get("ISCC"), shutil.which("ISCC"),
                  Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
                  Path(os.environ.get("ProgramFiles(x86)", "")) / "Inno Setup 6" / "ISCC.exe",
                  Path(os.environ.get("ProgramFiles", "")) / "Inno Setup 6" / "ISCC.exe"]
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)
    sys.exit("Inno Setup isn't installed. Run:\n    winget install JRSoftware.InnoSetup")


def make_assets():
    """From desktop/icon.png (the d20): icon.ico for the exes and the installer, and the wizard's two pictures (side panel, corner)."""
    from PIL import Image, ImageDraw, ImageFilter
    WORK.mkdir(parents=True, exist_ok=True)
    src = Image.open(HERE / "icon.png").convert("RGBA")
    src.save(WORK / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    bg = tuple(src.getpixel((4, 4))[:3])
    # the side panel at three scales (Windows picks the one that fits the screen's DPI)
    for scale in (1, 1.5, 2):
        w, h = int(164 * scale), int(314 * scale)
        panel = Image.new("RGB", (w, h), bg)
        logo = src.resize((w, w), Image.LANCZOS)
        fade = Image.new("L", logo.size, 0)
        ImageDraw.Draw(fade).ellipse((w * .02, w * .02, w * .98, w * .98), fill=255)
        logo.putalpha(fade.filter(ImageFilter.GaussianBlur(w * .07)))
        panel.paste(logo, (0, int(h * .28)), logo)
        panel.save(WORK / f"wizard-large-{int(scale * 100)}.bmp")
    src.convert("RGB").resize((55, 55), Image.LANCZOS).save(WORK / "wizard-small.bmp")


def main():
    if sys.platform != "win32":
        sys.exit("The installer is Windows-only for now.")
    try:
        import PyInstaller  # noqa: F401
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller and Pillow are needed. Run:\n    python -m pip install -r desktop/requirements-build.txt")
    iscc = find_iscc()
    version = (HERE / "VERSION").read_text(encoding="utf-8").strip()
    shutil.rmtree(OUT, ignore_errors=True)
    shutil.rmtree(WORK, ignore_errors=True)
    make_assets()

    print("1/2  the app")
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--workpath", str(WORK / "pyi"),
                    "--specpath", str(WORK), "--distpath", str(WORK / "app"), str(HERE / "app.py"), "--name", APP_NAME, "--onedir",
                    "--paths", str(HERE), "--icon", str(WORK / "icon.ico"), "--add-data", f"{HERE / 'VERSION'};."], check=True)

    print("2/2  the installer")
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run([iscc, "/Qp", f"/DAppDir={WORK / 'app' / APP_NAME}", f"/DAppVersion={version}", f"/DBuildDir={WORK}",
                    f"/DOutDir={OUT}", str(HERE / "installer.iss")], check=True)
    final = OUT / f"DnD-Companion-Installer-{version}-windows.exe"
    print(f"built {final} ({final.stat().st_size / 1e6:.1f} MB)")

    if "--publish" in sys.argv:
        dest = Path(sys.argv[sys.argv.index("--publish") + 1])
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(final, dest / final.name)
        print(f"Published to {dest}")


if __name__ == "__main__":
    main()
