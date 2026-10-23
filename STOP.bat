@echo off
title TrackFlow - Stop
echo.
echo  [*] Stopping TrackFlow container...
cd /d "%~dp0"
docker-compose down
echo.
echo  [+] TrackFlow stopped.
echo.
pause
