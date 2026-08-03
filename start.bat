@echo off
setlocal EnableDelayedExpansion
title DupeNoMore

echo ============================================
echo   DupeNoMore - Starting...
echo ============================================
echo.

:: ── Node.js ──────────────────────────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js not found. Installing via winget...
    winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [ERROR] Could not install Node.js automatically.
        echo         Please install it from https://nodejs.org ^(LTS version^)
        echo         then run start.bat again.
        echo.
        pause
        exit /b 1
    )
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "PATH=%%b"
    set "PATH=!PATH!;%ProgramFiles%\nodejs"
    where node >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [!] Node.js installed but PATH not updated yet.
        echo     Please close this window and run start.bat again.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Node.js installed.
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ── App directory ─────────────────────────────────────────────────────────────
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"
if not exist "data"  mkdir data
if not exist "scans" mkdir scans

:: ── npm packages ──────────────────────────────────────────────────────────────
if not exist "node_modules\express\package.json" (
    echo [!] Installing packages ^(first run, ~30 seconds^)...
    call npm install --omit=dev
    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Packages installed.
) else (
    echo [OK] Packages ready.
)

:: ── CLIP model check (optional - downloaded on demand from Settings > Search tab) ─────
:: CLIP is optional: provides AI semantic image search (~350MB download on first use)
:: Download is triggered from the Search tab in the app, no action needed here
:: If you have a HuggingFace token, enter it in Settings for faster/authenticated downloads

:: ── ffmpeg check ^(optional — for video thumbnails^) ──────────────────────────
where ffmpeg >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo [OK] ffmpeg found - video thumbnails enabled.
) else (
    if exist "%APP_DIR%ffmpeg.exe" (
        echo [OK] ffmpeg.exe found next to app - video thumbnails enabled.
    ) else (
        echo [i] ffmpeg not found - video thumbnails disabled.
        echo     To enable: place ffmpeg.exe next to start.bat,
        echo     or run:  winget install ffmpeg  in a terminal, then restart.
    )
)

:: ── Port check ────────────────────────────────────────────────────────────────
netstat -ano 2>nul | find ":8888" | find "LISTENING" >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo [!] Port 8888 already in use - opening existing instance...
    start "" "http://localhost:8888"
    exit /b 0
)

:: ── Start server ──────────────────────────────────────────────────────────────
echo [OK] Starting server...
echo.
start "DupeNoMore Server" /D "%APP_DIR%" cmd /k _loop.bat

echo [..] Waiting for server to be ready...
set /a TRIES=0

:wait_loop
timeout /t 1 /nobreak >nul 2>&1
set /a TRIES+=1
powershell -NoProfile -Command "try { $null = Invoke-WebRequest 'http://localhost:8888/api/health' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if !ERRORLEVEL! EQU 0 goto server_ready
if !TRIES! LSS 30 goto wait_loop

echo.
echo [ERROR] Server did not respond within 30 seconds.
echo         Check the DupeNoMore Server window for error messages.
echo.
pause
exit /b 1

:server_ready
echo [OK] Server running at http://localhost:8888
echo.
echo ============================================
echo   DupeNoMore  ^|  http://localhost:8888
echo   Close the SERVER window to stop the app.
echo ============================================
echo.
start "" "http://localhost:8888"
echo This launcher window can now be closed.
echo.
pause
