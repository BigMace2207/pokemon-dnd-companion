"""
Runs the Pokedex/Companion app as a desktop window instead of a browser tab
-- same server.py underneath (in-process here, not a subprocess, so this
still works once PyInstaller freezes it into a single .exe/.app with no
separate Python install needed), just opened in a native OS window via
pywebview (Edge WebView2 on Windows, WebKit on Mac) instead of a URL bar.

Multiplayer still works the same way: this window is also serving the app
on your LAN, so other players still connect from their own phone/laptop
browser at the "On your network" address printed on startup -- this window
is just this computer's own way of viewing it.

Run:
    python desktop.py [port]

Build a standalone app (see build_desktop.py for the one-command version):
    pyinstaller --noconfirm --windowed --name "Pokemon D&D" --add-data "data;data" ... desktop.py
"""
import http.server
import json
import sys
import threading

import webview

import server

# Remembers the window mode (see the Api class below) across launches --
# separate from server.STATE_FILE since it's a purely local UI preference,
# not campaign data, but lives in the same frozen-vs-source-aware folder
# (see server._data_dir()) for the same reason: a packaged build's own
# folder can be read-only or get wiped/replaced on update.
PREFS_FILE = server.DATA_DIR / ".desktop_prefs.json"


def load_window_mode():
    try:
        data = json.loads(PREFS_FILE.read_text(encoding="utf-8"))
        mode = data.get("windowMode")
        if mode in ("windowed", "borderless", "fullscreen"):
            return mode
    except Exception:
        pass
    return "windowed"


def save_window_mode(mode):
    try:
        PREFS_FILE.write_text(json.dumps({"windowMode": mode}), encoding="utf-8")
    except Exception:
        pass


class Api:
    """Exposed to the page as `pywebview.api.*` (see js/views/settings.js's
    Window section). pywebview's Window has no live "toggle frameless"
    method -- frameless is a create_window()-time-only option -- so
    Borderless is saved as a preference and applied next launch, while
    Windowed and Fullscreen both switch immediately via toggle_fullscreen().
    `_window` is filled in right after create_window() returns (see main());
    every real call from JS happens well after that, once webview.start()'s
    event loop is actually running."""

    def __init__(self):
        self._window = None
        self._fullscreen = False

    def set_window_mode(self, mode):
        if mode not in ("windowed", "borderless", "fullscreen"):
            return {"error": "bad mode"}
        save_window_mode(mode)
        want_fullscreen = mode == "fullscreen"
        if self._window is not None and want_fullscreen != self._fullscreen:
            self._window.toggle_fullscreen()
            self._fullscreen = want_fullscreen
        return {"mode": mode, "needsRestart": mode == "borderless"}

    def get_window_mode(self):
        return {"mode": load_window_mode(), "fullscreen": self._fullscreen}

    def toggle_fullscreen(self):
        """F11 (see js/fullscreenControl.js) -- a plain toggle, independent
        of the saved windowMode preference, same as F11 in a real browser."""
        if self._window is not None:
            self._window.toggle_fullscreen()
            self._fullscreen = not self._fullscreen
        return {"fullscreen": self._fullscreen}


def start_server():
    server.load_state_from_disk()
    threading.Thread(target=server.autosave_loop, daemon=True).start()
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", server.PORT), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


F11_LOG = None  # set once we know where to write (see _install_f11_override)
# Kept alive at module scope -- a local variable would be GC'd once
# _install_f11_override() returns, stopping the timer.
_F11_TIMER = None


def _f11_log(msg):
    """--windowed PyInstaller builds have no console -- sys.stdout is None,
    and a bare print() there raises instead of doing nothing, which was
    silently swallowing every diagnostic from the first version of this
    function (caught by its own except, one frame up). Route through a
    real file instead so a failure here is actually visible after the
    fact rather than just vanishing."""
    try:
        if F11_LOG:
            with open(F11_LOG, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
    except Exception:
        pass


def _install_f11_override(window, api):
    """F11 (see js/fullscreenControl.js) never reaches that JS handler on
    Windows -- WebView2 swallows F11 itself as a built-in browser
    accelerator before the keypress is ever dispatched to the page's DOM
    (a known WebView2 quirk: see MicrosoftEdge/WebView2Feedback#56),
    independent of the AreBrowserAcceleratorKeysEnabled setting.

    Three earlier attempts all failed, confirmed by dumping diagnostics to
    disk rather than guessing:
      1. Form.KeyPreview + Form.KeyDown -- never fired. WebView2 isn't a
         normal hosted .NET Control that opts into the Form's key-preview
         pipeline; it's its own out-of-process browser engine with its own
         input routing.
      2. ICoreWebView2Controller.AcceleratorKeyPressed -- the documented
         WebView2-level hook for exactly this. Reflection over the actual
         WinForms WebView2 control showed it exposes CoreWebView2 but not
         CoreWebView2Controller at all in this SDK version -- nothing to
         attach to.
      3. RegisterHotKey targeting the Form's own handle, caught via a
         NativeWindow.AssignHandle() subclass overriding WndProc.
         RegisterHotKey itself succeeded, but WndProc was never invoked
         for ANY message afterward (logged a marker for every distinct
         message type seen -- none ever arrived), meaning pythonnet's
         override wasn't actually wired into the real Win32 subclassing
         AssignHandle sets up.

    This instead avoids the whole "catch a Windows message" problem: a
    plain WinForms.Timer polls GetAsyncKeyState(VK_F11) every 120ms,
    edge-triggering (acts once per press-and-release, not repeatedly while
    held) and only while this window is the foreground window. No hook, no
    message interception, no subclassing -- just checking one specific
    key's current state, which is a normal, narrowly-scoped Win32 call
    (can't observe anything else pressed) rather than an event-based catch
    of *every* keystroke. Timer.Tick already runs on the UI thread on its
    own, so this needs no thread marshaling."""
    if sys.platform != "win32":
        return

    global F11_LOG
    F11_LOG = str(server.DATA_DIR / "f11_debug.log")

    import ctypes

    VK_F11 = 0x7A
    user32 = ctypes.windll.user32
    user32.GetAsyncKeyState.restype = ctypes.c_short
    user32.GetForegroundWindow.restype = ctypes.c_void_p

    def attach():
        try:
            from webview.platforms.winforms import BrowserView
            import System.Windows.Forms as WinForms
            from System import Action

            form = BrowserView.instances[window.uid]
            was_down = [False]

            def on_tick(sender, e):
                try:
                    down = bool(user32.GetAsyncKeyState(VK_F11) & 0x8000)
                    if down and not was_down[0] and user32.GetForegroundWindow() == int(form.Handle.ToInt64()):
                        api.toggle_fullscreen()
                    was_down[0] = down
                except Exception as tick_err:
                    _f11_log(f"tick error: {tick_err}")

            def setup_on_ui_thread():
                try:
                    global _F11_TIMER
                    _F11_TIMER = WinForms.Timer()
                    _F11_TIMER.Interval = 120
                    _F11_TIMER.Tick += on_tick
                    _F11_TIMER.Start()
                    _f11_log("F11 poll timer started")
                except Exception as ui_err:
                    _f11_log(f"setup_on_ui_thread error: {ui_err}")

            form.Invoke(Action(setup_on_ui_thread))
        except Exception as e:
            # Best-effort -- these are pywebview/WinForms internals, not
            # public API, and could change; fall back to the Settings
            # page's Fullscreen button rather than crash the app over a
            # hotkey.
            _f11_log(f"F11 native override not installed: {e}")

    window.events.loaded += attach


# Set to point this window at an always-on server (see README's "Hosting
# and security" section) instead of the local one this same process would
# otherwise start below -- so this PC shares one campaign with everyone
# else connecting to that address, rather than this PC's own local
# .server_state.dat silently drifting into its own separate copy. Empty
# string reverts to the old fully-local/LAN-only behavior.
REMOTE_SERVER_URL = "https://pokemon-dnd.duckdns.org"


def main():
    start_server()  # still runs locally too, e.g. as a fallback if the remote host is ever unreachable
    ip = server.lan_ip()
    app_url = REMOTE_SERVER_URL or f"http://localhost:{server.PORT}"
    if REMOTE_SERVER_URL:
        print(f"Connected to the shared campaign server at: {REMOTE_SERVER_URL}")
        print(f"(this PC's own local server is also running at http://localhost:{server.PORT} if you ever need it)")
    elif ip:
        print(f"Other players on your Wi-Fi can join at: http://{ip}:{server.PORT}")
    title = "Pokémon D&D Companion" + (f"  —  {app_url}" if REMOTE_SERVER_URL else (f"  —  others on your Wi-Fi: http://{ip}:{server.PORT}" if ip else ""))

    mode = load_window_mode()
    api = Api()
    window = webview.create_window(
        title,
        app_url,
        width=1320, height=880, min_size=(900, 600),
        frameless=(mode == "borderless"),
        fullscreen=(mode == "fullscreen"),
        js_api=api,
    )
    api._window = window
    api._fullscreen = mode == "fullscreen"
    _install_f11_override(window, api)
    # private_mode defaults to True in pywebview -- that runs the embedded
    # WebView2/WebKit browser as an incognito session, so "My Team" (saved
    # in the page's own localStorage, see js/storage.js) never survives a
    # restart. Explicit storage_path also pins the profile to this app's
    # own data folder instead of a location that can drift between runs.
    webview.start(private_mode=False, storage_path=str(server.DATA_DIR / "webview_storage"))


if __name__ == "__main__":
    main()
