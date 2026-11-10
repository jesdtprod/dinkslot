@echo off
setlocal
cd /d "%~dp0"

set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=py -3"
    goto :serve
)
python --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    goto :serve
)

echo Python 3 is required. Install it from https://www.python.org/downloads/
pause
exit /b 1

:serve
echo Starting DINKSLOT at http://localhost:%PORT%
echo Keep this window open. Press Ctrl+C to stop the server.
start "" "http://localhost:%PORT%"
%PYTHON% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 pause
