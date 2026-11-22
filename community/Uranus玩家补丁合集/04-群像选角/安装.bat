@echo off
rem ============================================================
rem  Uranus - Cast Stage (offline multi-character scenes) - installer
rem
rem  Double-click this file. Chinese output comes from install.mjs;
rem  this batch file stays plain ASCII on purpose (cmd.exe mishandles
rem  multi-byte characters in .bat files).
rem
rem  Installed somewhere else?  set URANUS_ROOT=D:\Uranus  first.
rem ============================================================

chcp 65001 >nul
title Uranus - Install Cast Stage
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
