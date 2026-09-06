Option Explicit
' Scheduled-task entry point. Launches run-daily.ps1 with a hidden window.
'
' ASCII only on purpose: VBScript reads .vbs files using the system ANSI code page,
' so UTF-8 Chinese text in here would be decoded as garbage and can break parsing
' (a compile error makes Windows Script Host pop up a modal dialog).
' Keep this file ASCII; put the explanations in the .ps1 instead.
'
' Task action:  wscript.exe "<full path to this file>"
Dim fso, sh, baseDir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & baseDir & "\run-daily.ps1"""
sh.Run cmd, 0, False
