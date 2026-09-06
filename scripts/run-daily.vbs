Option Explicit
' 隐藏窗口启动 run-daily.ps1。
' 计划任务原来直接调 run-daily.cmd，会在屏幕上弹一个 PowerShell 控制台窗口
' （空白、点不动、一关就把整期日报掐断）。改由 wscript 以隐藏方式启动。
' 计划任务里的调用方式：wscript.exe "<本文件完整路径>"
Dim fso, sh, baseDir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & baseDir & "\run-daily.ps1"""
sh.Run cmd, 0, False
