@echo off
rem Double-click me: opens the schedule settings window.
start "" powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\schedule-gui.ps1"
