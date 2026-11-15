"""
Builds the app people download from fluxdev.org/download (app.py): a small window onto the live site, no server and no data folders
bundled. Output is a zip named the way server.py's download route expects (PokemonDnD-Companion-<version>-<platform>.zip).

Setup (once):   python -m pip install -r desktop/requirements-build.txt
Build:          python desktop/build_app.py [--publish <folder>]

PyInstaller only builds for the OS it runs on: run this on Windows for the Windows zip, on a Mac for the Mac one.
The version is desktop/VERSION. --publish copies the zip into that folder (the server's downloads folder: PKDND_DOWNLOAD_DIR, by
default <data dir>/downloads; on the VM ~/pokemon-dnd/downloads). Deploys never touch that folder, so builds stay up.
"""
import shutil
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SEP = ";" if sys.platform == "win32" else ":"
APP_NAME = "Pokemon D&D Companion"
PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")


def make_icon():
    """Best-effort .ico/.icns from assets/logo.png; a missing icon isn't worth failing the build."""
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
        if sys.platform == "darwin":
            out = ROOT / "assets" / "app.icns"
            img.save(out, format="ICNS")
            return str(out)
    except Exception as e:
        print(f"(skipping custom icon: {e})")
    return None


def zip_folder(src, dest):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path in sorted(src.rglob("*")):
            if path.is_file():
                z.write(path, Path(src.name) / path.relative_to(src))


def main():
    try:
        import PyInstaller.__main__
    except ImportError:
        print("PyInstaller isn't installed. Run:\n    python -m pip install -r desktop/requirements-build.txt")
        sys.exit(1)
    version = (HERE / "VERSION").read_text(encoding="utf-8").strip()
    args = [
        str(HERE / "app.py"), "--name", APP_NAME, "--onedir", "--windowed", "--noconfirm", "--clean",
        "--paths", str(HERE), "--distpath", str(ROOT / "dist-app"), "--workpath", str(ROOT / "build-app"),
        "--specpath", str(ROOT / "build-app"),
        "--add-data", f"{HERE / 'VERSION'}{SEP}.",
    ]
    icon = make_icon()
    if icon:
        args += ["--icon", icon]
    print("Running PyInstaller...")
    PyInstaller.__main__.run(args)

    built = ROOT / "dist-app" / APP_NAME
    zip_path = ROOT / "dist-app" / f"PokemonDnD-Companion-{version}-{PLATFORM}.zip"
    zip_path.unlink(missing_ok=True)
    zip_folder(built, zip_path)
    print(f"\nBuilt {zip_path} ({zip_path.stat().st_size / 1e6:.1f} MB)")

    if "--publish" in sys.argv:
        dest = Path(sys.argv[sys.argv.index("--publish") + 1])
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copy2(zip_path, dest / zip_path.name)
        print(f"Published to {dest}")


if __name__ == "__main__":
    main()
