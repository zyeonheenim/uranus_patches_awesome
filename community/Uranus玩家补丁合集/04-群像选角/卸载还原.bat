@echo off
rem ============================================================
rem  Uranus - Cast Stage - uninstaller
rem
rem  Restores the patched source files from the newest backup and
rem  moves the stage card / preset / closeout scripts aside. Your
rem  characters, memories and story data are never touched.
rem ============================================================

chcp 65001 >nul
title Uranus - Uninstall Cast Stage
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [X] Node.js not found. Install v20+ from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node "%~dp0uninstall.mjs"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo   Uninstaller exited with code %RC%.
pause
exit /b %RC%
