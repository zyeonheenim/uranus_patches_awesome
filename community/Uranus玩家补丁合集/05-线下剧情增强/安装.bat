@echo off
rem ============================================================
rem  Uranus - Offline story enhancements - installer
rem
rem  Installs four features on the offline story page:
rem    02 version history  (re-roll / manual edits recoverable)
rem    03 bubble style     (per-side colours, stored server-side)
rem    04 model + token    (which model answered, how many tokens)
rem    05 jump buttons     (top / prev / next / bottom)
rem
rem  One-click for all four by default. To install just one:
rem    cd files
rem    node installer.mjs --only 05 --run
rem
rem  Plain ASCII on purpose: cmd.exe mishandles multi-byte
rem  characters inside .bat files. Chinese output comes from
rem  installer.mjs, which node prints as UTF-8.
rem ============================================================

chcp 65001 >nul
title Uranus - Install Offline Enhancements
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [X] Node.js not found. Install v20+ from https://nodejs.org
  echo       then double-click this file again.
  echo.
  pause
  exit /b 1
)

rem  URANUS_ROOT wins if you set it; the installer also checks URANUS_DIR.
if defined URANUS_ROOT set "URANUS_DIR=%URANUS_ROOT%"

cd /d "%~dp0files"
node "installer.mjs" --only 02,03,04,05 --run
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo   Installer exited with code %RC%.
echo.
pause
exit /b %RC%
