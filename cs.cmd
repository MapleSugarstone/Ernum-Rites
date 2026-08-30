@echo off
setlocal
cd /d "%~dp0"
title Ernum Rites C# engine

where dotnet >nul 2>nul
if errorlevel 1 (
  echo.
  echo The .NET SDK was not found on your PATH.
  echo Install it from https://dotnet.microsoft.com/download and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo === C# rules tests ===
dotnet run --project csharp\Selatza.Tests
if errorlevel 1 goto failed

echo.
echo === Replay corpus ===
dotnet run -c Release --project csharp\Selatza.Sim -- verify
if errorlevel 1 goto failed

echo.
echo === Bot sweep, every deck pairing ===
dotnet run -c Release --project csharp\Selatza.Sim -- sweep --games 40
if errorlevel 1 goto failed

echo.
echo All C# checks passed.
pause
exit /b 0

:failed
echo.
echo Something failed. Scroll up for the details.
pause
exit /b 1
