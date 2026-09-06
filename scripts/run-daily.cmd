@echo off
rem Scheduled-task entry point: hands off to run-daily.ps1 in the same folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-daily.ps1" %*
