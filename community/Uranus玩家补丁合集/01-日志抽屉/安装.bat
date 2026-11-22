@echo off
rem ============================================================
rem  Uranus - Live Log Drawer + Model Switcher - installer
rem
rem  Double-click this file. All Chinese output comes from
rem  install.mjs, so this batch file stays plain ASCII on purpose:
rem  cmd.exe mis-parses multi-byte characters in .bat files.
rem
rem  Installed somewhere else?  set URANUS_ROOT=D:\Uranus  first.
rem ============================================================

chcp 65001 >nul
title Uranus - Install Log Drawer
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

node "%~dp0install.mjs"
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" echo   Installer exited with code %RC%.
pause
exit /b %RC%
