@echo off
REM ─────────────────────────────────────────────────────────────────────────────
REM deploy.bat — Build frontend and integrate it into the backend (Windows)
REM Usage: deploy.bat [--skip-install]
REM ─────────────────────────────────────────────────────────────────────────────
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "STATIC_DIR=%BACKEND_DIR%\app\static"
set "SKIP_INSTALL=false"

for %%A in (%*) do (
  if "%%A"=="--skip-install" set "SKIP_INSTALL=true"
)

echo.
echo  ==========================================
echo           Vocabox ^— Deploy Script
echo  ==========================================
echo.

REM ── 1. Frontend dependencies ──────────────────────────────────────────────
cd /d "%FRONTEND_DIR%"

if "%SKIP_INSTALL%"=="false" (
  echo [1/4] Installing frontend dependencies...
  call npm install --silent
  if errorlevel 1 ( echo ERROR: npm install failed & exit /b 1 )
  echo       Done.
) else (
  echo [1/4] Skipping npm install (--skip-install).
)

REM ── 2. Build frontend ─────────────────────────────────────────────────────
echo [2/4] Building frontend...
call npm run build
if errorlevel 1 ( echo ERROR: npm run build failed & exit /b 1 )
echo       Built: %FRONTEND_DIR%\dist

REM ── 3. Copy dist → backend\app\static ────────────────────────────────────
echo [3/4] Copying dist to backend\app\static...
if exist "%STATIC_DIR%" rd /s /q "%STATIC_DIR%"
xcopy /e /i /q "%FRONTEND_DIR%\dist" "%STATIC_DIR%" >nul
if errorlevel 1 ( echo ERROR: xcopy failed & exit /b 1 )
echo       Copied: %STATIC_DIR%

REM ── 4. Backend dependencies ───────────────────────────────────────────────
cd /d "%BACKEND_DIR%"
set "VENV_DIR=%BACKEND_DIR%\.venv"

if "%SKIP_INSTALL%"=="false" (
  echo [4/4] Installing backend dependencies...
  if not exist "%VENV_DIR%" (
    python -m venv "%VENV_DIR%"
    if errorlevel 1 ( echo ERROR: venv creation failed & exit /b 1 )
  )
  call "%VENV_DIR%\Scripts\activate.bat"
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
  if errorlevel 1 ( echo ERROR: pip install failed & exit /b 1 )
  echo       Done.
) else (
  echo [4/4] Skipping pip install (--skip-install).
)

echo.
echo  Deploy complete.
echo.
echo   Start the server:   cd backend ^& start.bat
echo   App URL:            http://localhost:9009
echo   API docs:           http://localhost:9009/docs
echo.

endlocal
