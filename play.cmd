@echo off
setlocal
cd /d "%~dp0"
title Ernum Rites

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on your PATH.
  echo Install it from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies. This only happens the first time.
  echo.
  call npm install
  if errorlevel 1 goto failed
  echo.
)

echo Starting Ernum Rites. Your browser will open in a moment.
echo Close this window, or press Ctrl+C, to stop the server.
echo.
call npm run dev -- --open
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo That did not work. The output above should say why.
echo.
pause
exit /b 1
