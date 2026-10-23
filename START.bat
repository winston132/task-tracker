@echo off
title TrackFlow Launcher
color 0A
echo.
echo  ████████╗██████╗  █████╗  ██████╗██╗  ██╗███████╗██╗      ██████╗ ██╗    ██╗
echo     ██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝██║     ██╔═══██╗██║    ██║
echo     ██║   ██████╔╝███████║██║     █████╔╝ █████╗  ██║     ██║   ██║██║ █╗ ██║
echo     ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ██╔══╝  ██║     ██║   ██║██║███╗██║
echo     ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗██║     ███████╗╚██████╔╝╚███╔███╔╝
echo     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝
echo.
echo  Task Tracker - Starting up...
echo  ─────────────────────────────────────────────────────────

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [!] Docker is not running. Attempting to start Docker Desktop...
    echo.
    start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    echo  [*] Waiting for Docker Desktop to start (this may take 30-60 seconds)...
    echo.

    :wait_loop
    timeout /t 5 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 (
        echo  [.] Still waiting...
        goto wait_loop
    )
)

echo  [+] Docker is running!
echo.
echo  [*] Starting TrackFlow container...
cd /d "%~dp0"
docker-compose up -d

if %errorlevel% neq 0 (
    echo.
    echo  [!] Failed to start container. Trying to rebuild...
    docker-compose up -d --build
)

echo.
echo  ─────────────────────────────────────────────────────────
echo  [+] TrackFlow is live at: http://localhost:3000
echo  ─────────────────────────────────────────────────────────
echo.

REM Open the browser automatically
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo  Press any key to view container logs, or close this window.
pause >nul
docker logs -f trackflow
