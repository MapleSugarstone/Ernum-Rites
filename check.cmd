@echo off
setlocal
cd /d "%~dp0"
title Ernum Rites checks

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on your PATH. Install it from https://nodejs.org.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies. This only happens the first time.
  call npm install
  if errorlevel 1 goto failed
)

echo.
echo === Rules and bot tests ===
call npm test
if errorlevel 1 goto failed

echo.
echo === Types (client and worker) ===
call npm run typecheck
if errorlevel 1 goto failed

echo.
echo === C# rules, card and learning tests ===
where dotnet >nul 2>nul
if errorlevel 1 (
  echo   .NET SDK not found, skipping the C# side.
) else (
  dotnet run --project csharp\Selatza.Tests
  if errorlevel 1 goto failed
  echo.
  echo === Cross-engine replay conformance ===
  call npx vitest run tests/conformance.test.ts
  if errorlevel 1 goto failed
  echo.
  echo === Bot sweep, every deck pairing ===
  dotnet run -c Release --project csharp\Selatza.Sim -- sweep --games 20
  if errorlevel 1 goto failed

  echo.
  echo === Network gradients ===
  dotnet run -c Release --project csharp\Selatza.Train -- gradcheck
  if errorlevel 1 goto failed
)

echo.
echo Everything passed.
pause
exit /b 0

:failed
echo.
echo Something failed. Scroll up for the details.
pause
exit /b 1
