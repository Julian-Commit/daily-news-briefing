Option Explicit
' Scheduled-task entry point. Runs poll-discord.js with a hidden window so the
' every-minute poll never flashes a console on screen.
'
' ASCII only on purpose: VBScript reads .vbs files using the system ANSI code page,
' so UTF-8 Chinese text in here would be decoded as garbage and can break parsing
' (a compile error makes Windows Script Host pop up a modal dialog -- once a minute
' for this task). Keep this file ASCII; put the explanations in the .js instead.
'
' Task action:  wscript.exe "<full path to this file>"
Dim fso, sh, baseDir, nodeExe, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
cmd = """" & nodeExe & """ """ & baseDir & "\poll-discord.js"""
sh.Run cmd, 0, False
