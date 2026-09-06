Option Explicit
' 隐藏窗口启动 poll-discord.js，避免计划任务每分钟弹一次黑框。
' 计划任务里的调用方式：wscript.exe "<本文件完整路径>"
Dim fso, sh, baseDir, nodeExe, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"
cmd = """" & nodeExe & """ """ & baseDir & "\poll-discord.js"""
sh.Run cmd, 0, False
