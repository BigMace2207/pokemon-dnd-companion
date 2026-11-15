"""
Builds what people download from fluxdev.org/download on Windows: one installer .exe ("D&D Companion Installer", installer.py) that
carries the app (app.py: a small window onto the live site, no server or data folders) inside it.

Setup (once):   python -m pip install -r desktop/requirements-build.txt
Build:          python desktop/build_app.py [--publish <folder>]

Steps: build the app folder (PyInstaller, --onedir), zip it as the installer's payload, then build installer.py (--onefile) with that
zip packed in. Result: dist-app/DnD-Companion-Installer-<version>-windows.exe (the name server.py's download route expects; it is
served to people as "D&D Companion Installer.exe"). The version is desktop/VERSION and the icon is desktop/icon.png.
--publish copies the installer into that folder (the server's downloads folder: PKDND_DOWNLOAD_DIR, by default <data dir>/downloads;
on the VM ~/pokemon-dnd/downloads). Deploys never touch that folder, so builds stay up.

Windows only for now: PyInstaller builds for the OS it runs on, and a Mac installer (.dmg) would be built on a Mac.
"""
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "dist-app"
WORK = ROOT / "build-app"
APP_NAME = "DnD Companion"                   # the app's folder and .exe: no "&" in anything on disk
INSTALLER_NAME = "DnD Companion Installer"


def make_icons():
    """desktop/icon.png (the d20) -> icon.ico for the exes' icons; the png is also shown in the installer's window."""
    from PIL import Image
    WORK.mkdir(parents=True, exist_ok=True)
    ico = WORK / "icon.ico"
    Image.open(HERE / "icon.png").convert("RGBA").save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    # the picture shown in the installer's window: the same d20 with its edges faded out, so it sits on the window's dark background
    from PIL import ImageDraw, ImageFilter
    logo = Image.open(HERE / "icon.png").convert("RGBA")
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).ellipse((10, 10, logo.width - 10, logo.height - 10), fill=255)
    logo.putalpha(mask.filter(ImageFilter.GaussianBlur(34)))
    logo.save(WORK / "logo.png")
    return ico


def pyinstaller(*args):
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed", "--workpath", str(WORK / "pyi"),
                    "--specpath", str(WORK), "--distpath", str(OUT), *map(str, args)], check=True)


def zip_folder(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(src.rglob("*")):
            if path.is_file():
                z.write(path, Path(src.name) / path.relative_to(src))


def main():
    if sys.platform != "win32":
        sys.exit("The installer is Windows-only for now.")
    try:
        import PyInstaller  # noqa: F401
        import PIL  # noqa: F401
    except ImportError:
        sys.exit("PyInstaller and Pillow are needed. Run:\n    python -m pip install -r desktop/requirements-build.txt")
    version = (HERE / "VERSION").read_text(encoding="utf-8").strip()
    ico = make_icons()
    shutil.rmtree(OUT, ignore_errors=True)

    print("1/3  the app")
    pyinstaller(HERE / "app.py", "--name", APP_NAME, "--onedir", "--paths", HERE, "--icon", ico, "--add-data", f"{HERE / 'VERSION'};.")
    payload = WORK / "payload" / "app.zip"
    zip_folder(OUT / APP_NAME, payload)

    print("2/3  the installer")
    pyinstaller(HERE / "installer.py", "--name", INSTALLER_NAME, "--onefile", "--icon", ico,
                "--add-data", f"{payload};payload", "--add-data", f"{HERE / 'VERSION'};.",
                "--add-data", f"{ico};.", "--add-data", f"{WORK / 'logo.png'};.")
    final = OUT / f"DnD-Companion-Installer-{version}-windows.exe"
    (OUT / f"{INSTALLER_NAME}.exe").replace(final)
    shutil.rmtree(OUT / APP_NAME, ignore_errors=True)    # (it lives inside the installer now)
    print(f"3/3  built {final} ({final.stat().st_size / 1e6:.1f} MB)")

    if "--publish" in sys.argv:
        dest = Path(sys.argv[sys.argv.index("--publish") + 1])
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(final, dest / final.name)
        print(f"Published to {dest}")


if __name__ == "__main__":
    main()
