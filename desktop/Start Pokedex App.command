#!/bin/bash
# Mac launcher. Double-click in Finder to run (first time, you may need to
# right-click -> Open once, since it's not from a notarized developer).
cd "$(dirname "$0")"

echo "Pokemon D&D Companion"
echo "================"
echo

PYTHON=python3
command -v python3 >/dev/null 2>&1 || PYTHON=python
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "Python 3 wasn't found. Install it from https://www.python.org/downloads/"
  echo "(or 'brew install python3' if you use Homebrew), then run this again."
  read -p "Press Enter to close..."
  exit 1
fi

if ! "$PYTHON" -c "import webview" >/dev/null 2>&1; then
  echo "Installing the desktop window package (first run only)..."
  "$PYTHON" -m pip install --quiet -r requirements-desktop.txt
  echo
fi

echo "Starting app (leave this window open while you use it)..."
echo
"$PYTHON" desktop.py
