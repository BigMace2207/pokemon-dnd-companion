"""
The window around the site, shared by both desktop apps: app.py (the small one you download from fluxdev.org/download: just a window
onto the live site) and desktop.py (the self-hosted one, which also serves the site from this computer). A window is made with
pywebview (Edge WebView2 on Windows, WebKit on a Mac), and this file is everything that makes it behave like an app:

  - it remembers how big you left it, and Windowed / Borderless / Fullscreen (the website's Settings has a Window section that
    talks to this through `window.pywebview.api`, see Api below);
  - F11 toggles fullscreen on Windows (see install_f11_override: WebView2 swallows the key before the page sees it);
  - if the site can't be reached when it starts, it shows a plain page that says so, with a button to try again;
  - the page can tell it is inside the app (window.pywebview exists), which is how the start screen hides "Download the app here".

Nothing here needs the website's own code, so app.py can be packaged without bundling the server (build_app.py).
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import webview

MODES = ("windowed", "borderless", "fullscreen")
BACKGROUND = "#07070b"   # what the window shows before the first page paints (no white flash)


# ---------------------------------------------------------------- what is remembered between launches
def _prefs_file(data_dir):
    return Path(data_dir) / ".desktop_prefs.json"


def load_prefs(data_dir):
    try:
        data = json.loads(_prefs_file(data_dir).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_prefs(data_dir, **changes):
    """Purely local UI preferences (window mode and size), not campaign data: kept in the app's own data folder, so a packaged build's
    own folder (which can be read-only, or replaced on update) is never written to."""
    try:
        prefs = load_prefs(data_dir)
        prefs.update(changes)
        _prefs_file(data_dir).write_text(json.dumps(prefs), encoding="utf-8")
    except Exception:
        pass


def load_window_mode(data_dir):
    mode = load_prefs(data_dir).get("windowMode")
    return mode if mode in MODES else "windowed"


# ---------------------------------------------------------------- what the page can ask the window to do
class Api:
    """Exposed to the page as `pywebview.api.*` (the website's Settings -> Video -> Window section, and F11, js/fullscreenControl.js).
    pywebview's Window has no live "toggle frameless" (frameless is a create_window()-time option only), so Borderless is saved and
    applied next launch, while Windowed and Fullscreen both switch at once via toggle_fullscreen(). `_window` is filled in right
    after create_window() returns; every real call from the page happens well after that, once the event loop is running."""

    def __init__(self, data_dir, url, version=""):
        self._data_dir = data_dir
        self._url = url
        self._version = version
        self._window = None
        self._fullscreen = False

    def set_window_mode(self, mode):
        if mode not in MODES:
            return {"error": "bad mode"}
        save_prefs(self._data_dir, windowMode=mode)
        want_fullscreen = mode == "fullscreen"
        if self._window is not None and want_fullscreen != self._fullscreen:
            self._window.toggle_fullscreen()
            self._fullscreen = want_fullscreen
        return {"mode": mode, "needsRestart": mode == "borderless"}

    def get_window_mode(self):
        return {"mode": load_window_mode(self._data_dir), "fullscreen": self._fullscreen}

    def toggle_fullscreen(self):
        """F11: a plain toggle, independent of the saved mode, like F11 in a real browser."""
        if self._window is not None:
            self._window.toggle_fullscreen()
            self._fullscreen = not self._fullscreen
        return {"fullscreen": self._fullscreen}

    def retry(self):
        """The "Try again" button on the offline page."""
        if self._window is not None:
            self._window.load_url(self._url)
        return {"ok": True}

    def app_info(self):
        return {"version": self._version}


# ---------------------------------------------------------------- the site isn't there
def reachable(url, timeout=6):
    """True if the server answered at all (even with an error page): False only when nothing could be reached."""
    try:
        urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=timeout).close()
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def offline_html(url):
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Can't reach the site</title>
<style>
html,body{{height:100%;margin:0;background:{BACKGROUND};color:#fafafa;font-family:system-ui,"Segoe UI",sans-serif}}
body{{display:grid;place-items:center;text-align:center;padding:24px;background:radial-gradient(70% 55% at 75% 10%,rgba(98,70,190,.4),transparent 70%),radial-gradient(60% 50% at 15% 95%,rgba(200,60,20,.3),transparent 70%),{BACKGROUND}}}
main{{max-width:420px}} h1{{font-size:30px;font-weight:600;margin:0 0 10px}} p{{margin:0 0 22px;color:rgba(255,255,255,.7);line-height:1.5}}
button{{font:inherit;font-weight:600;font-size:16px;color:#0b0b0c;background:#fff;border:0;border-radius:999px;padding:12px 28px;cursor:pointer}}
button:active{{transform:scale(.97)}} small{{display:block;margin-top:18px;color:rgba(255,255,255,.45)}}
</style></head><body><main>
<h1>Can't reach the site</h1>
<p>Check your internet connection, then try again. Your campaigns are safe: they live on the site, not on this computer.</p>
<button id="retry" type="button">Try again</button><small>{url}</small>
</main><script>
document.getElementById("retry").addEventListener("click", function () {{
  if (window.pywebview && window.pywebview.api) window.pywebview.api.retry(); else location.reload();
}});
</script></body></html>"""


# ---------------------------------------------------------------- F11 on Windows
_F11_LOG = None    # set once we know where to write (see install_f11_override)
_F11_TIMER = None  # kept alive at module scope: a local would be garbage collected, stopping the timer


def _f11_log(msg):
    """--windowed PyInstaller builds have no console (sys.stdout is None, and a bare print() there raises), so diagnostics go to a file."""
    try:
        if _F11_LOG:
            with open(_F11_LOG, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
    except Exception:
        pass


def install_f11_override(window, api, log_file):
    """F11 never reaches the page's own key handler on Windows: WebView2 swallows it as a built-in browser accelerator before the
    keypress is dispatched to the DOM (a known quirk: MicrosoftEdge/WebView2Feedback#56). Three approaches that need a hook into
    WebView2's input (Form.KeyPreview, the controller's AcceleratorKeyPressed, RegisterHotKey with a WndProc subclass) all failed
    here, confirmed by dumping diagnostics rather than guessing. This avoids catching a message at all: a plain WinForms.Timer polls
    GetAsyncKeyState(VK_F11) every 120 ms, acts once per press (edge-triggered), and only while this window is the foreground
    window. It can only see that one key's state, never anything else typed."""
    if sys.platform != "win32":
        return

    global _F11_LOG
    _F11_LOG = str(log_file)

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
            # Best-effort: these are pywebview/WinForms internals, not public API. Fall back to the website's Fullscreen button.
            _f11_log(f"F11 native override not installed: {e}")

    window.events.loaded += attach


# ---------------------------------------------------------------- the window itself
def run(url, title, data_dir, version=""):
    """Open `url` in a native window and block until it is closed."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    prefs = load_prefs(data_dir)
    mode = load_window_mode(data_dir)
    api = Api(data_dir, url, version)
    page = {"url": url} if reachable(url) else {"html": offline_html(url)}
    window = webview.create_window(
        title,
        width=max(900, int(prefs.get("width") or 1320)), height=max(600, int(prefs.get("height") or 880)), min_size=(900, 600),
        frameless=(mode == "borderless"), fullscreen=(mode == "fullscreen"),
        js_api=api, background_color=BACKGROUND, text_select=True,   # (text can be selected: invite codes, notes)
        **page,
    )
    api._window = window
    api._fullscreen = mode == "fullscreen"

    def remember_size():   # (not while fullscreen: that is the screen's size, not the window's)
        if not api._fullscreen:
            save_prefs(data_dir, width=int(window.width), height=int(window.height))

    window.events.closing += remember_size
    install_f11_override(window, api, data_dir / "f11_debug.log")
    # private_mode defaults to True in pywebview, which runs the embedded browser as an incognito session, so anything the site keeps in
    # localStorage (js/storage.js: a local copy of "My Team") would never survive a restart. An explicit storage_path pins the profile
    # to this app's own data folder instead of a location that can drift between runs.
    webview.start(private_mode=False, storage_path=str(data_dir / "webview_storage"))
