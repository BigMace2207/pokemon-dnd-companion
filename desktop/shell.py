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
import threading
import time
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

    def __init__(self, data_dir, url, version="", custom_frame=False):
        self._data_dir = data_dir
        self._url = url
        self._version = version
        self._custom_frame = custom_frame   # no Windows title bar: the page draws its own minimise / maximise / close (js/windowControls.js)
        self._window = None
        self._form = None                   # the WinForms window, once it exists (see install_frame)
        self._start_fullscreen = False      # the saved mode is Fullscreen: switched on once the window exists (see install_frame)
        self._borderless = False            # the saved "Borderless" mode (the window has no frame at all)
        self._maxed = False                 # grown to the work area (see toggle_maximize)
        self._normal_rect = None            # where it was before, to shrink back to
        self._animating = False
        self._fullscreen = False

    def _frameless_again(self):
        """Back to no frame at all. (pywebview restores the border it noted when fullscreen began, and for a window that started
        fullscreen that was Windows' own, so a title bar came back when you left fullscreen.)"""
        if self._custom_frame and self._form is not None and sys.platform == "win32":
            def fix():
                import System.Windows.Forms as WinForms
                self._form.FormBorderStyle = getattr(WinForms.FormBorderStyle, "None")
            try:
                from System import Action
                self._form.Invoke(Action(fix))
            except Exception:
                pass

    def _update_border(self):
        """Windows 11 draws a thin line round a frameless window. In fullscreen and borderless it should have none."""
        if sys.platform == "win32" and self._hwnd:
            _set_border_hidden(self._hwnd, self._fullscreen or self._borderless)

    def set_window_mode(self, mode):
        if mode not in MODES:
            return {"error": "bad mode"}
        save_prefs(self._data_dir, windowMode=mode)
        want_fullscreen = mode == "fullscreen"
        if self._window is not None and want_fullscreen != self._fullscreen:
            self._window.toggle_fullscreen()
            self._fullscreen = want_fullscreen
            if not want_fullscreen:
                self._frameless_again()
        self._update_border()
        return {"mode": mode, "needsRestart": mode == "borderless"}

    def get_window_mode(self):
        return {"mode": load_window_mode(self._data_dir), "fullscreen": self._fullscreen}

    def toggle_fullscreen(self):
        """F11: a plain toggle, independent of the saved mode, like F11 in a real browser."""
        if self._window is not None:
            self._window.toggle_fullscreen()
            self._fullscreen = not self._fullscreen
            if not self._fullscreen:
                self._frameless_again()
            self._update_border()
        return {"fullscreen": self._fullscreen}

    def retry(self):
        """The "Try again" button on the offline page."""
        if self._window is not None:
            self._window.load_url(self._url)
        return {"ok": True}

    def open_signin(self, code):
        """Google won't sign anyone in inside an embedded window, so the page asks for the system browser on the site's own sign-in page
        (assets/signin). `code` is the one-off id the server just made; only that page on this site is ever opened."""
        import re
        import webbrowser
        if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", code):
            return {"error": "bad code"}
        webbrowser.open(f"{self._url.rstrip('/')}/app-signin?code={code}")
        return {"ok": True}

    def app_info(self):
        return {"version": self._version}

    # ---- the window's own buttons, for a window without a title bar (called by js/windowControls.js)
    def get_frame(self):
        return {"custom": self._custom_frame, "maximized": self._is_maximized(), "fullscreen": self._fullscreen}

    def _is_maximized(self):
        return self._maxed

    def minimize(self):
        if self._window is not None:
            self._window.minimize()
        return self.get_frame()

    def toggle_maximize(self):
        """Grow to the work area (the screen minus the taskbar), or shrink back, with a short animation instead of a jump. The window
        isn't put into Windows' own Maximised state (that snaps instantly and a frameless window would cover the taskbar): it is
        simply moved to the work area, and remembers where it was."""
        if sys.platform != "win32" or not self._hwnd or self._animating:
            return self.get_frame()
        if self._maxed:
            target, self._maxed = self._normal_rect, False
        else:
            self._normal_rect = _window_rect(self._hwnd)
            target, self._maxed = _work_area(self._hwnd), True
        threading.Thread(target=self._glide, args=(target,), daemon=True).start()
        return self.get_frame()

    def _glide(self, target):
        self._animating = True
        try:
            _animate_rect(self._hwnd, target)
        finally:
            self._animating = False

    def close(self):
        if self._window is not None:
            self._window.destroy()

    def begin_resize(self, edge):
        """A window with no frame has no edges to grab, so the page draws thin grips and asks for a resize here. Runs until the mouse
        button is let go, moving the window with SetWindowPos on every step (smooth, and no round trip through the page per pixel)."""
        if sys.platform == "win32" and self._hwnd and edge in ("n", "s", "e", "w", "ne", "nw", "se", "sw") and not self._is_maximized():
            threading.Thread(target=_resize_loop, args=(self._hwnd, edge), daemon=True).start()
        return True

    _hwnd = 0


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


# ---------------------------------------------------------------- a window with no title bar (Windows)
def _resize_loop(hwnd, edge, min_w=900, min_h=600):
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    rect, pt = wintypes.RECT(), wintypes.POINT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    user32.GetCursorPos(ctypes.byref(pt))
    left, top, right, bottom, x0, y0 = rect.left, rect.top, rect.right, rect.bottom, pt.x, pt.y
    SWP = 0x0004 | 0x0010   # SWP_NOZORDER | SWP_NOACTIVATE
    while user32.GetAsyncKeyState(0x01) & 0x8000:   # VK_LBUTTON: while the button is held
        user32.GetCursorPos(ctypes.byref(pt))
        dx, dy = pt.x - x0, pt.y - y0
        l, t, r, b = left, top, right, bottom
        if "w" in edge:
            l = min(left + dx, right - min_w)
        if "e" in edge:
            r = max(right + dx, left + min_w)
        if "n" in edge:
            t = min(top + dy, bottom - min_h)
        if "s" in edge:
            b = max(bottom + dy, top + min_h)
        user32.SetWindowPos(hwnd, 0, l, t, r - l, b - t, SWP)
        time.sleep(0.008)


def _set_border_hidden(hwnd, hidden):
    """DWMWA_BORDER_COLOR (Windows 11): DWMWA_COLOR_NONE takes the outline away, DWMWA_COLOR_DEFAULT puts it back. Older Windows: no effect."""
    import ctypes
    try:
        value = ctypes.c_uint(0xFFFFFFFE if hidden else 0xFFFFFFFF)
        ctypes.windll.dwmapi.DwmSetWindowAttribute(ctypes.c_void_p(hwnd), 34, ctypes.byref(value), 4)
    except Exception:
        pass


def _window_rect(hwnd):
    import ctypes
    from ctypes import wintypes
    r = wintypes.RECT()
    ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def _work_area(hwnd):
    """The screen the window is on, minus the taskbar."""
    import ctypes
    from ctypes import wintypes

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]
    user32 = ctypes.windll.user32
    user32.MonitorFromWindow.restype = ctypes.c_void_p
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFO)]
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(info))   # 2 = nearest monitor
    w = info.rcWork
    return (w.left, w.top, w.right, w.bottom)


def _animate_rect(hwnd, target, ms=240):
    """Slide and stretch the window from where it is to `target`, easing out (fast at first, settling gently)."""
    import ctypes
    user32 = ctypes.windll.user32
    start = _window_rect(hwnd)
    t0 = time.perf_counter()
    while True:
        t = min(1.0, (time.perf_counter() - t0) * 1000 / ms)
        k = 1 - (1 - t) ** 3
        l, tp, r, b = (round(a + (z - a) * k) for a, z in zip(start, target))
        user32.SetWindowPos(hwnd, 0, l, tp, r - l, b - tp, 0x0004 | 0x0010)   # SWP_NOZORDER | SWP_NOACTIVATE
        if t >= 1.0:
            break
        time.sleep(0.008)


def install_frame(window, api):
    """Once the window exists, remember its WinForms form and handle (read on the UI thread, where WinForms allows it) for the
    buttons and resize grips above."""
    if sys.platform != "win32":
        return

    def attach():
        try:
            from webview.platforms.winforms import BrowserView
            from System import Action
            form = BrowserView.instances[window.uid]

            def grab():
                api._form = form
                api._hwnd = int(form.Handle.ToInt64())
                api._update_border()
            form.Invoke(Action(grab))
            if api._start_fullscreen:   # the saved mode is Fullscreen: now that the window exists and has no frame, go fullscreen
                api._start_fullscreen = False
                api.toggle_fullscreen()
        except Exception as e:
            _f11_log(f"window frame not installed: {e}")

    window.events.loaded += attach


# ---------------------------------------------------------------- the window itself
def run(url, title, data_dir, version="", custom_frame=False):
    """Open `url` in a native window and block until it is closed."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    prefs = load_prefs(data_dir)
    mode = load_window_mode(data_dir)
    custom_frame = custom_frame and sys.platform == "win32"
    api = Api(data_dir, url, version, custom_frame)
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True   # (a button inside the draggable top strip must still click)
    page = {"url": url} if reachable(url) else {"html": offline_html(url)}
    window = webview.create_window(
        title,
        width=max(900, int(prefs.get("width") or 1320)), height=max(600, int(prefs.get("height") or 880)), min_size=(900, 600),
        frameless=(custom_frame or mode == "borderless"), easy_drag=False, shadow=custom_frame, fullscreen=(mode == "fullscreen" and not custom_frame),
        js_api=api, background_color=BACKGROUND, text_select=True,   # (text can be selected: invite codes, notes)
        **page,
    )
    api._window = window
    api._fullscreen = mode == "fullscreen" and not custom_frame
    api._start_fullscreen = mode == "fullscreen" and custom_frame
    api._borderless = mode == "borderless"

    def remember_size():   # (not while fullscreen: that is the screen's size, not the window's)
        if api._fullscreen:
            return
        if api._maxed and api._normal_rect:   # (what to open at next time is the window's own size, not the work area's)
            l, t, r, b = api._normal_rect
            save_prefs(data_dir, width=r - l, height=b - t)
        else:
            save_prefs(data_dir, width=int(window.width), height=int(window.height))

    window.events.closing += remember_size
    install_f11_override(window, api, data_dir / "f11_debug.log")
    install_frame(window, api)
    # private_mode defaults to True in pywebview, which runs the embedded browser as an incognito session, so anything the site keeps in
    # localStorage (js/storage.js: a local copy of "My Team") would never survive a restart. An explicit storage_path pins the profile
    # to this app's own data folder instead of a location that can drift between runs.
    webview.start(private_mode=False, storage_path=str(data_dir / "webview_storage"))
