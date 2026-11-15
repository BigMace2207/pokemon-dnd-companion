"""
The self-hosted desktop app: the same server.py (in-process, not a subprocess, so it still works once PyInstaller freezes it into one
app with no separate Python install) plus a native window onto it. The window itself (size memory, F11, Window settings, the
"can't reach the site" page) is shell.py, shared with app.py, the small download from fluxdev.org/download that is only a window onto
the live site. Use this one when you want a copy of the whole server on this computer.

Multiplayer still works the same way: this process also serves the app on your LAN, so other players connect from their own
phone/laptop browser at the "On your network" address printed on startup.

Run:
    python desktop.py

Build a standalone app (see build_desktop.py for the one-command version).
"""
import http.server
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # server.py lives one folder up
import server
import shell

# Point this window at an always-on server (see README's "Hosting and security") instead of the local one this same process also
# starts, so this PC shares one campaign with everyone else connecting to that address, rather than its own local .server_state.dat
# silently drifting into a separate copy. Empty string reverts to the fully local / LAN-only behaviour.
REMOTE_SERVER_URL = "https://fluxdev.org"


def start_server():
    server.load_state_from_disk()
    threading.Thread(target=server.autosave_loop, daemon=True).start()
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", server.PORT), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


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
    shell.run(app_url, title, server.DATA_DIR)


if __name__ == "__main__":
    main()
