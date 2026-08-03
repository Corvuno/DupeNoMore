@echo off
echo ============================================================
echo   DupeNoMore Browser Tests
echo ============================================================
echo.
echo Starting server...
start /B node src\server.js > nul 2>&1
timeout /t 3 /nobreak > nul

echo Running tests...
node tests\browser-check.js
set RESULT=%ERRORLEVEL%

echo.
echo Stopping server...
taskkill /F /IM node.exe > nul 2>&1
timeout /t 1 /nobreak > nul

if %RESULT% EQU 0 (
    echo.
    echo   ALL TESTS PASSED
) else (
    echo.
    echo   SOME TESTS FAILED — see above
)
pause
