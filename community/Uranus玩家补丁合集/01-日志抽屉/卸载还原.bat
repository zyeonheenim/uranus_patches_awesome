@echo off
rem ============================================================
rem  Uranus - Live Log Drawer + Model Switcher - uninstaller
rem
rem  Restores client/src/shell.jsx and server/src/index.js from the
rem  newest backup, removes client/src/logdrawer.jsx, rebuilds the
rem  front end and restarts Uranus.
rem  Plain ASCII on purpose - see the installer .bat for why.
rem ============================================================

chcp 65001 >nul
title Uranus - Uninstall Log Drawer
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
