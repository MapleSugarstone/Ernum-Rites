@echo off
rem Starts scripts\gcp-versus.sh detached from any terminal or session, so a
rem head-to-head batch survives the session that launched it. From PowerShell,
rem with the repo as the working directory:
rem   Start-Process -WindowStyle Hidden -FilePath scripts\gcp-versus.cmd -ArgumentList 'love 600 "c3-standard-176" "us-central1-a" "--decks candy --seed 12"'
rem Arms hold spaces, so each one is quoted inside the single argument string.
rem The batch appends to runs\<tag>-versus.log; tail that file to follow it.
setlocal
set "HERE=%~dp0"
set "LOG=%HERE%..\runs\%1-versus.log"
"C:\Program Files\Git\bin\bash.exe" "%HERE%gcp-versus.sh" %* >> "%LOG%" 2>&1
