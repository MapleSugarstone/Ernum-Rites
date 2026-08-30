@echo off
setlocal
cd /d "%~dp0"
title Ernum Rites training

where dotnet >nul 2>nul
if errorlevel 1 (
  echo.
  echo The .NET SDK was not found on your PATH.
  echo Install it from https://dotnet.microsoft.com/download and run this again.
  echo.
  pause
  exit /b 1
)

if "%~1"=="" goto default
dotnet run -c Release --project csharp\Selatza.Train -- %*
if errorlevel 1 goto failed
goto done

:default
echo.
echo Training a population of networks against each other.
echo.
echo The run snapshots itself after every round into runs\latest, so if this
echo window closes, the machine reboots or something crashes, starting it
echo again picks up where it stopped. Press Ctrl+C to stop cleanly.
echo.
echo For balancing cards, run it without the networks instead. That is about
echo 41,000 games in thirty seconds, and it writes cards.txt, meta.csv and
echo decks.txt into the output folder:
echo.
echo   train.cmd train --no-net --rounds 400 --agents 24 --games 8 --out runs\v1
echo   train.cmd matchup --a runs\v1\best-deck.txt --swap old-id=new-id
echo   train.cmd diff --before runs\v1\cards.csv --after runs\v2\cards.csv
echo   train.cmd probe                  ( watch the scouting work )
echo   train.cmd deck --count 3         ( see what decks it builds )
echo.
dotnet run -c Release --project csharp\Selatza.Train -- train --rounds 120
if errorlevel 1 goto failed

:done
echo.
pause
exit /b 0

:failed
echo.
echo Something failed. Scroll up for the details.
echo Any completed rounds are still saved, so running this again resumes them.
echo.
pause
exit /b 1
