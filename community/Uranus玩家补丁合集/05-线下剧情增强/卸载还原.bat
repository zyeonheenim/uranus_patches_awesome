@echo off
rem ============================================================
rem  Uranus - Offline story enhancements - uninstaller
rem
rem  Restores every patched file byte-for-byte from the backup
rem  taken at install time (.patches-backup-<stamp>). Your
rem  characters, memories and story data are never touched.
rem ============================================================

chcp 65001 >nul
title Uranus - Uninstall Offline Enhancements
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [X] Node.js not found. Install v20+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if defined URANUS_ROOT set "URANUS_DIR=%URANUS_ROOT%"

cd /d "%~dp0files"
node "uninstaller.mjs" --run
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo   Uninstaller exited with code %RC%.
echo.
pause
exit /b %RC%
