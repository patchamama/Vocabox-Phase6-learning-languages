@echo off
setlocal enabledelayedexpansion

set VENV_DIR=.venv

echo === Vocabox Backend ===

:: ── Read PORT from .env (fallback to 9009) ────────────────────────────────────
set PORT=9009
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if "%%a"=="PORT" (
            set _raw=%%b
            :: strip leading/trailing spaces
            for /f "tokens=* delims= " %%x in ("!_raw!") do set PORT=%%x
        )
    )
)

:: ── Free the port if something is already listening on it ─────────────────────
echo [0/3] Checking port %PORT%...
set _FREED=0
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr /C.":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%P >nul 2>&1
    set _FREED=1
)
if "!_FREED!"=="1" (
    echo       Process on port %PORT% stopped.
) else (
    echo       Port %PORT% is free.
)

:: ── Virtual environment ───────────────────────────────────────────────────────
if exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [1/3] Virtual environment already exists -- skipping.
) else (
    echo [1/3] Creating virtual environment...
    python -m venv %VENV_DIR%
    if errorlevel 1 (
        echo ERROR: Could not create virtual environment.
        echo        Make sure Python 3.11+ is installed and in PATH.
        pause
        exit /b 1
    )
    echo       Done.
)

:: ── Activate ──────────────────────────────────────────────────────────────────
call "%VENV_DIR%\Scripts\activate.bat"

:: ── Dependencies ──────────────────────────────────────────────────────────────
echo [2/3] Installing / updating dependencies...
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)
echo       Done.

:: ── Run ───────────────────────────────────────────────────────────────────────
echo [3/3] Starting server on port %PORT%...
echo.
python run.py

endlocal
