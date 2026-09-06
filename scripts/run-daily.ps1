# run-daily.ps1 — 供 Windows 计划任务调用，无头跑一期日报。
#
# 手动测试:
#   powershell -ExecutionPolicy Bypass -File scripts\run-daily.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\run-daily.ps1 -Prompt "/daily"
#
# 用你的 Claude 订阅额度跑，不需要 API key。日志写在 logs\daily-<北京日期>.log。
#
# 注意：这里必须直接调原生 claude.exe，**不能**调 claude.cmd。
# PowerShell 执行 .cmd 会拉起 cmd.exe，而 cmd.exe 会新开一个控制台窗口
# （屏幕上就是那个空白、点不动的小白框），且不受计划任务隐藏启动的约束；
# 用户一关它，整期日报就被掐断。poll-discord.js 里也是同样的处理。

param(
    [string]$Prompt = "/daily 全自动"
)

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# 日志按北京日期命名，和刊号保持一致
$beijing = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, "China Standard Time")
$log = Join-Path $logDir ("daily-" + $beijing.ToString("yyyy-MM-dd") + ".log")

# 找原生 exe：npm 全局目录 → PATH。找不到才退回 .cmd（会有控制台窗口，但总比跑不了强）
$claude = $null
foreach ($c in @(
    (Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'),
    (Join-Path $env:LOCALAPPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe')
)) {
    if ((Test-Path $c) -and ((Get-Item $c).Length -gt 0)) { $claude = $c; break }
}
if (-not $claude) {
    $found = Get-Command claude.exe -ErrorAction SilentlyContinue
    if ($found) { $claude = $found.Source }
}
if (-not $claude) { $claude = Join-Path $env:APPDATA 'npm\claude.cmd' }

"" | Tee-Object -FilePath $log -Append
"=== 开始 本机 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') / 北京 $($beijing.ToString('yyyy-MM-dd HH:mm:ss')) ===" | Tee-Object -FilePath $log -Append
"    仓库 $root" | Tee-Object -FilePath $log -Append
"    命令 $claude -p `"$Prompt`"" | Tee-Object -FilePath $log -Append
"    （claude 跑完才会一次性输出，中途这里看着是空的属正常，通常十几分钟）" | Tee-Object -FilePath $log -Append

& $claude -p $Prompt --permission-mode acceptEdits --output-format text 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

"=== 结束 $(Get-Date -Format 'HH:mm:ss')，退出码 $code ===" | Tee-Object -FilePath $log -Append

if ($code -ne 0) {
    "" | Tee-Object -FilePath $log -Append
    "失败排查（按可能性排序）：" | Tee-Object -FilePath $log -Append
    "  1. 日志里出现 OAuth session expired  → 在本目录开一次交互式 claude 重新登录" | Tee-Object -FilePath $log -Append
    "  2. 出现 workspace has not been trusted → 同上，交互式跑一次并接受信任对话框" | Tee-Object -FilePath $log -Append
    "  3. Discord 报 403 / code 50013        → 频道权限给 bot 单独加 Send Messages = ALLOW" | Tee-Object -FilePath $log -Append
    "  4. 缺 DISCORD_BOT_TOKEN               → 在仓库根目录建 .env（参考 .env.example）" | Tee-Object -FilePath $log -Append
    "  5. 退出码 -1073741510                 → 进程被强制中断（多半是有人关掉了窗口）" | Tee-Object -FilePath $log -Append
}

# 只保留最近 60 天日志
Get-ChildItem -Path $logDir -Filter "daily-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
