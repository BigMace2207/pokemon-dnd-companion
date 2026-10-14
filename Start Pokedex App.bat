@echo off
cd /d "%~dp0"
echo Pokemon D^&D Companion
echo ================
echo.
python -c "import webview" >nul 2>&1
if errorlevel 1 (
    echo Installing the desktop window package -- first run only...
    python -m pip install --quiet -r requirements-desktop.txt
    echo.
)
echo Starting app (leave this window open while you use it)...
echo.
python desktop.py
pause
