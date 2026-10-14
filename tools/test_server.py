"""
Run a throwaway copy of the app for testing a branch, fork or future idea,
completely separate from real saves.

    python tools/test_server.py                    # this checkout, http://localhost:8860
    python tools/test_server.py ../some-fork       # another checkout (a fork, a branch worktree)
    python tools/test_server.py --lan              # also reachable from your phone on the same Wi-Fi
    python tools/test_server.py --port 8870 --reset

The test copy keeps its accounts and campaigns in ~/.pkdnd-test/<folder name>
(never the real save file), listens only on this computer unless you pass
--lan, and shows an obvious "TEST" marker in the console. Create a fresh
account and campaign inside it; --reset wipes just that test data.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("checkout", nargs="?", default=str(Path(__file__).resolve().parent.parent), help="folder containing server.py")
    ap.add_argument("--port", type=int, default=8860)
    ap.add_argument("--lan", action="store_true", help="let other devices on your network connect")
    ap.add_argument("--reset", action="store_true", help="delete this test copy's saved data first")
    args = ap.parse_args()

    checkout = Path(args.checkout).resolve()
    if not (checkout / "server.py").is_file():
        sys.exit(f"No server.py in {checkout}")
    data_dir = Path.home() / ".pkdnd-test" / checkout.name
    if args.reset and data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ, PKDND_DATA_DIR=str(data_dir), PKDND_BIND="0.0.0.0" if args.lan else "127.0.0.1")
    for var in ("PKDND_GOOGLE_CLIENT_ID", "PKDND_APPLE_CLIENT_ID", "PKDND_LEGACY_DM_PASSWORD", "PKDND_TRUST_PROXY", "PKDND_BACKUP_DIR"):
        env.pop(var, None)  # a test copy never inherits real sign-in config or backup folders

    print("=" * 60)
    print(f" TEST SERVER for {checkout}")
    print(f" http://localhost:{args.port}   (data: {data_dir})")
    print(" Not the live site. Ctrl+C to stop.")
    print("=" * 60)
    try:
        subprocess.run([sys.executable, "server.py", str(args.port)], cwd=checkout, env=env)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
