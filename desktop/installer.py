"""
"D&D Companion Installer": what people download from fluxdev.org/download on Windows. One .exe that carries the app inside it
(build_app.py puts the app's folder, zipped, in the bundle as payload/app.zip), shows a small window, and on Install:

  - closes a running copy, then unpacks the app into %LOCALAPPDATA%\\Programs\\DnD Companion (a per-user folder, so no admin prompt);
  - adds a Start menu entry, and a desktop shortcut if ticked;
  - registers the app with Windows' "Installed apps" so it can be removed there (uninstall.ps1, written next to the app).

Why an installer rather than a zip: Windows marks every file of a downloaded zip as "from the internet", and the .NET half of the
window (pythonnet, Python.Runtime.dll) then refuses to load, so the app died on start with "Failed to resolve
Python.Runtime.Loader.Initialize". Files this installer writes itself carry no such mark. Updating is running a newer installer
over the old one; the app's own settings (%APPDATA%\\Pokemon D&D Companion App) are never touched.

For testing:  installer.py --silent [--dest <folder>] [--no-shortcuts]   (no window; --dest skips the Start menu and Windows' list)
"""
import os
import shutil
import subprocess
import sys
import threading
import zipfile
from pathlib import Path

APP_TITLE = "D&D Companion"
FOLDER = "DnD Companion"          # no "&" in anything on disk
EXE = "DnD Companion.exe"
REG_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\DnDCompanion"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def bundle():
    """Where the files packed into this exe live (PyInstaller's temp folder, or desktop/ when run from source)."""
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def version():
    try:
        return (bundle() / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "dev"


def default_dest():
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Programs" / FOLDER


def start_menu():
    return Path(os.environ.get("APPDATA") or Path.home()) / "Microsoft" / "Windows" / "Start Menu" / "Programs"


def desktop_dir():
    return Path(os.environ.get("USERPROFILE") or Path.home()) / "Desktop"


def stop_running_app():
    """An app that is open holds its files, so the copy over it would fail."""
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/IM", EXE], capture_output=True, creationflags=NO_WINDOW)


def shortcut(path, target, workdir):
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($args[0]);$s.TargetPath=$args[1];$s.WorkingDirectory=$args[2];"
          "$s.IconLocation=$args[1];$s.Description='" + APP_TITLE + "';$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps, str(path), str(target), str(workdir)],
                   capture_output=True, creationflags=NO_WINDOW, check=True)


UNINSTALL_PS1 = r'''# Removes D&D Companion: its shortcuts, its entry in Installed apps, and this folder. Settings in %APPDATA% are left alone.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Get-Process -Name "DnD Companion" -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -LiteralPath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\D&D Companion.lnk" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$env:USERPROFILE\Desktop\D&D Companion.lnk" -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DnDCompanion" -Recurse -Force -ErrorAction SilentlyContinue
Start-Process cmd -WindowStyle Hidden -ArgumentList "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q `"$here`""
'''


def register(dest, size):
    import winreg
    exe = dest / EXE
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_KEY) as k:
        for name, value in {
            "DisplayName": APP_TITLE, "DisplayVersion": version(), "Publisher": "fluxdev.org", "InstallLocation": str(dest),
            "DisplayIcon": str(exe),
            "UninstallString": f'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{dest / "uninstall.ps1"}"',
        }.items():
            winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)
        winreg.SetValueEx(k, "EstimatedSize", 0, winreg.REG_DWORD, int(size / 1024))
        winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)


def install(dest, desktop_shortcut=True, shortcuts=True, progress=lambda fraction, text: None):
    """Unpack the app into `dest` (replacing an older install) and set up shortcuts. Raises on failure."""
    dest = Path(dest)
    payload = bundle() / "payload" / "app.zip"
    progress(0.02, "Closing the app if it is open…")
    stop_running_app()
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
        if dest.exists():
            raise RuntimeError(f"Couldn't replace the old version in {dest}. Close D&D Companion and try again.")
    dest.mkdir(parents=True)
    with zipfile.ZipFile(payload) as z:
        members = [m for m in z.infolist() if not m.is_dir()]
        total = sum(m.file_size for m in members) or 1
        done = 0
        for m in members:
            parts = Path(m.filename).parts[1:]    # the zip's own top folder is dropped
            if not parts or ".." in parts:
                continue
            out = dest.joinpath(*parts)
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            done += m.file_size
            progress(0.05 + 0.85 * done / total, "Installing…")
    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    (dest / "uninstall.ps1").write_text(UNINSTALL_PS1, encoding="utf-8")
    if shortcuts and sys.platform == "win32":
        progress(0.93, "Adding shortcuts…")
        start_menu().mkdir(parents=True, exist_ok=True)
        shortcut(start_menu() / f"{APP_TITLE}.lnk", dest / EXE, dest)
        if desktop_shortcut:
            shortcut(desktop_dir() / f"{APP_TITLE}.lnk", dest / EXE, dest)
        register(dest, size)
    progress(1.0, "Done")
    return dest


def launch(dest):
    subprocess.Popen([str(Path(dest) / EXE)], cwd=str(dest), creationflags=0x00000008)   # DETACHED_PROCESS


# ---------------------------------------------------------------- the window
BG, PANEL, TEXT, DIM = "#0c0606", "#17100f", "#fafafa", "#a39b97"


def run_window():
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title(f"{APP_TITLE} Installer")
    root.configure(bg=BG)
    root.resizable(False, False)
    w, h = 460, 420
    root.geometry(f"{w}x{h}+{(root.winfo_screenwidth() - w) // 2}+{(root.winfo_screenheight() - h) // 2}")
    try:
        root.iconbitmap(str(bundle() / "icon.ico"))
    except Exception:
        pass
    logo = None
    try:
        logo = tk.PhotoImage(file=str(bundle() / "logo.png")).subsample(3, 3)   # 512px -> 171px
    except Exception:
        pass

    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("D.Horizontal.TProgressbar", troughcolor=PANEL, background="#ff7a2f", bordercolor=PANEL, lightcolor="#ff7a2f", darkcolor="#ff7a2f", thickness=8)

    if logo:
        tk.Label(root, image=logo, bg=BG, bd=0).pack(pady=(26, 4))
    tk.Label(root, text=APP_TITLE, bg=BG, fg=TEXT, font=("Georgia", 24)).pack()
    tk.Label(root, text=f"Version {version()}", bg=BG, fg=DIM, font=("Segoe UI", 10)).pack(pady=(2, 16))

    body = tk.Frame(root, bg=BG)
    body.pack(fill="x", padx=48)
    shortcut_var = tk.BooleanVar(value=True)
    launch_var = tk.BooleanVar(value=True)
    check = dict(bg=BG, fg=TEXT, selectcolor=PANEL, activebackground=BG, activeforeground=TEXT, font=("Segoe UI", 10), bd=0, highlightthickness=0, anchor="w")
    opt = tk.Checkbutton(body, text="Add a desktop shortcut", variable=shortcut_var, **check)
    opt.pack(fill="x")
    bar = ttk.Progressbar(body, style="D.Horizontal.TProgressbar", maximum=100, mode="determinate")
    status = tk.Label(body, text="", bg=BG, fg=DIM, font=("Segoe UI", 10), wraplength=360, justify="center")

    button = tk.Button(root, text="Install", bg="#ffffff", fg="#0b0b0c", activebackground="#e8e8e8", relief="flat", bd=0, cursor="hand2",
                       font=("Segoe UI Semibold", 12), padx=40, pady=9)
    button.pack(pady=(22, 0))

    state = {"dest": None}

    def finish():
        if launch_var.get() and state["dest"]:
            launch(state["dest"])
        root.destroy()

    box = {"progress": (0, ""), "result": None}    # the install thread writes here; the window polls (Tk is not thread-safe)

    def set_progress(fraction, text):
        box["progress"] = (fraction, text)

    def poll():
        fraction, text = box["progress"]
        bar.configure(value=fraction * 100)
        status.configure(text=text)
        if box["result"] is not None:
            done(*box["result"])
        else:
            root.after(80, poll)

    def done(dest, error):
        bar.pack_forget()
        if error:
            status.configure(text=str(error), fg="#ff8a7a")
            button.configure(text="Close", state="normal", command=root.destroy)
            return
        state["dest"] = dest
        status.configure(text="Installed. You can find it in the Start menu.", fg=TEXT)
        opt.configure(text="Open D&D Companion now", variable=launch_var)
        opt.pack(fill="x", pady=(8, 0))
        button.configure(text="Finish", state="normal", command=finish)

    def work(want_desktop):
        try:
            dest = install(default_dest(), desktop_shortcut=want_desktop, progress=set_progress)
            box["result"] = (dest, None)
        except Exception as e:
            box["result"] = (None, e)

    def start():
        want_desktop = shortcut_var.get()
        opt.pack_forget()
        bar.pack(fill="x", pady=(6, 8))
        status.pack(fill="x")
        button.configure(state="disabled", text="Installing…")
        threading.Thread(target=work, args=(want_desktop,), daemon=True).start()
        poll()

    button.configure(command=start)
    root.mainloop()


def main():
    args = sys.argv[1:]
    if "--silent" in args:
        dest = Path(args[args.index("--dest") + 1]) if "--dest" in args else default_dest()
        install(dest, desktop_shortcut=False, shortcuts=("--dest" not in args and "--no-shortcuts" not in args),
                progress=lambda f, t: print(f"{int(f * 100):3d}%  {t}"))
        print(f"Installed to {dest}")
        return
    run_window()


if __name__ == "__main__":
    main()
