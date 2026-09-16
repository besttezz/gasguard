@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-gasguard.ps1"
if errorlevel 1 (
  echo.
  echo GasGuard could not be opened. Read the message above, then press any key.
  pause >nul
)
