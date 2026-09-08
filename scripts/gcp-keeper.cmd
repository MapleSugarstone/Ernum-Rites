@echo off
rem Starts scripts\gcp-keeper.sh detached from any terminal or session, so a
rem cloud run survives the session that launched it. From PowerShell:
rem   Start-Process -WindowStyle Hidden -FilePath scripts\gcp-keeper.cmd -ArgumentList 'rp 1 300 c3-standard-176,c3-standard-88 us-central1-a,us-central1-b,us-central1-c,us-central1-f 14h 1 60'
rem The keeper appends to runs\<tag>-keeper.log; tail that file to follow it.
setlocal
set "HERE=%~dp0"
set "LOG=%HERE%..\runs\%1-keeper.log"
"C:\Program Files\Git\bin\bash.exe" "%HERE%gcp-keeper.sh" %* >> "%LOG%" 2>&1
