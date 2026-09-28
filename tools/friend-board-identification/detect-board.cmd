@echo off
title GasGuard Board Identification Launcher
echo =======================================================================
echo GasGuard ESP32 Friend-Side Board Identification Tool
echo =======================================================================
echo.
echo Launching PowerShell detection script...
echo.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0detect-gasguard-board.ps1"

echo.
echo =======================================================================
echo Press any key to exit...
echo =======================================================================
pause > nul
