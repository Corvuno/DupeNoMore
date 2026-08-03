@echo off
:restart
node src\server.js
echo.
echo   Server stopped. Restarting in 3 seconds...
echo   (Close this window to stop permanently)
timeout /t 3 /nobreak >nul
goto restart
