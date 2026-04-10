@echo off
setlocal

set VENV_DIR=.venv

echo === Vocabox Backend ===

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
echo [3/3] Starting server ^(port from .env, default 9009^)...
echo.
python run.py

endlocal
