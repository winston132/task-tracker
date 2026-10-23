@echo off
title TrackFlow Dockerfile Runner
color 0B
echo.
echo  ===========================================================
echo   TrackFlow - Running directly from Dockerfile
echo  ===========================================================
echo.

REM 1. Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Docker is not running. Starting Docker Desktop...
    start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    echo  [*] Waiting for Docker daemon to become ready...
    :wait_docker
    timeout /t 4 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 goto wait_docker
)

echo  [+] Docker daemon is ready!
echo.

cd /d "%~dp0"

REM 2. Build the image using Dockerfile
echo  [*] Building Docker image from Dockerfile...
docker build -t task-tracker .
if %errorlevel% neq 0 (
    echo.
    echo  [!] Docker build failed! Check errors above.
    pause
    exit /b %errorlevel%
)

REM 3. Stop any previous container
echo  [*] Cleaning up previous container instance...
docker rm -f task-tracker >nul 2>&1
docker rm -f trackflow >nul 2>&1

REM 4. Run container with persistent tasks.json volume
echo  [*] Starting container task-tracker on port 3000...
docker run -d -p 3000:3000 --name task-tracker -v "%cd%\tasks.json:/app/tasks.json" --restart unless-stopped task-tracker

if %errorlevel% neq 0 (
    echo  [!] Failed to run container. Retrying without volume mount...
    docker run -d -p 3000:3000 --name task-tracker --restart unless-stopped task-tracker
)

echo.
echo  ===========================================================
echo   [+] Website is LIVE at: http://localhost:3000
echo  ===========================================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo  Showing live container logs (Press Ctrl+C to exit log view):
docker logs -f task-tracker
