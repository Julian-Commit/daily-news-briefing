# setup-tasks.ps1 — 创建/更新四个 Windows 计划任务。
#
# 用法（时间填**本机时间**，24 小时制）:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-tasks.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-tasks.ps1 -NewsTime 15:00 -ArchTime 15:20
#   powershell -ExecutionPolicy Bypass -File scripts\setup-tasks.ps1 -ShowOnly
#
# 为什么走 XML 而不是 schtasks 的命令行参数：
#   1. `schtasks /Change /ST` 会弹「请输入运行身份的密码」，在窗口程序里会直接卡住；
#      用 /Create /XML /F 整体覆盖则不会。
#   2. 命令行参数没法设「错过了就在下次可用时补跑」「最长跑多久」「已在运行就别再开一个」
#      这些设置——而这些恰恰重要：电脑那个点没开机时，补跑能救回当天的刊。

param(
    [string]$NewsTime = '',
    [string]$ArchTime = '',
    [switch]$ShowOnly
)

$ErrorActionPreference = 'Stop'

$ROOT_NEWS = Split-Path -Parent $PSScriptRoot
$ROOT_ARCH = Join-Path (Split-Path -Parent $ROOT_NEWS) 'News Agent Architecture'

$TASKS = @(
    @{ Name = 'Luxiansheng-Daily-News'; Cmd = (Join-Path $ROOT_NEWS 'scripts\run-daily.cmd');        Kind = 'daily';  Default = '15:00'; Desc = '陆先生日报：每天自动出刊（本机时间，= 北京 21:00）' }
    @{ Name = 'Luxiansheng-Daily-Arch'; Cmd = (Join-Path $ROOT_ARCH 'scripts\run-daily.cmd');        Kind = 'daily';  Default = '15:20'; Desc = '陆先生建筑日报：每天自动出刊（本机时间，= 北京 21:20）' }
    @{ Name = 'Luxiansheng-Discord-Poll-News'; Cmd = (Join-Path $ROOT_NEWS 'scripts\poll-discord.vbs'); Kind = 'minute'; Desc = '新闻日报：每分钟看一眼 Discord 频道' }
    @{ Name = 'Luxiansheng-Discord-Poll-Arch'; Cmd = (Join-Path $ROOT_ARCH 'scripts\poll-discord.vbs'); Kind = 'minute'; Desc = '建筑日报：每分钟看一眼 Discord 频道' }
)

function Get-CurrentTime([string]$name) {
    $xml = & schtasks /Query /TN $name /XML ONE 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $xml) { return $null }
    try {
        $sb = ([xml]($xml -join "`n")).Task.Triggers.CalendarTrigger.StartBoundary
        return ([DateTime]::Parse($sb)).ToString('HH:mm')
    } catch { return $null }
}

function New-TaskXml($task, [string]$time) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    if ($task.Kind -eq 'daily') {
        $trigger = @"
    <CalendarTrigger>
      <StartBoundary>${today}T${time}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
"@
        $limit = 'PT2H'
    } else {
        $trigger = @"
    <TimeTrigger>
      <StartBoundary>${today}T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
"@
        $limit = 'PT10M'
    }

    $isVbs = $task.Cmd -match '\.vbs$'
    $command = if ($isVbs) { 'wscript.exe' } else { $task.Cmd }
    $args = if ($isVbs) { "<Arguments>`"$($task.Cmd)`"</Arguments>" } else { '' }

    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$($task.Desc)</Description>
  </RegistrationInfo>
  <Triggers>
$trigger
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>$limit</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$command</Command>
      $args
      <WorkingDirectory>$(Split-Path -Parent (Split-Path -Parent $task.Cmd))</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

$times = @{
    'Luxiansheng-Daily-News' = if ($NewsTime) { $NewsTime } else { (Get-CurrentTime 'Luxiansheng-Daily-News') }
    'Luxiansheng-Daily-Arch' = if ($ArchTime) { $ArchTime } else { (Get-CurrentTime 'Luxiansheng-Daily-Arch') }
}

foreach ($t in $TASKS) {
    $time = $null
    if ($t.Kind -eq 'daily') {
        $time = $times[$t.Name]
        if (-not $time) { $time = $t.Default }
        if ($time -notmatch '^\d{1,2}:\d{2}$') { Write-Host "  ✗ $($t.Name) 时间格式不对：$time"; continue }
        $time = '{0:00}:{1:00}' -f [int]($time.Split(':')[0]), [int]($time.Split(':')[1])
    }

    if (-not (Test-Path $t.Cmd)) { Write-Host "  ✗ $($t.Name) 找不到 $($t.Cmd)"; continue }

    if ($ShowOnly) {
        $cur = if ($t.Kind -eq 'daily') { Get-CurrentTime $t.Name } else { '每分钟' }
        Write-Host ("  {0,-32} {1}" -f $t.Name, ($cur | ForEach-Object { if ($_) { $_ } else { '（未创建）' } }))
        continue
    }

    $xml = New-TaskXml $t $time
    $tmp = Join-Path $env:TEMP ($t.Name + '.xml')
    [System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)  # schtasks 要 UTF-16
    $out = & schtasks /Create /TN $t.Name /XML $tmp /F 2>&1
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("  ✓ {0,-32} {1}" -f $t.Name, $(if ($t.Kind -eq 'daily') { "每天 $time（本机）" } else { '每分钟' }))
    } else {
        Write-Host ("  ✗ {0} 创建失败：{1}" -f $t.Name, ($out -join ' '))
    }
}

if (-not $ShowOnly) {
    Write-Host ''
    Write-Host '设置要点：错过启动时间会在下次可用时补跑；已在运行时不会重复启动；'
    Write-Host '日报任务最长跑 2 小时，轮询任务 10 分钟；电池供电也照跑。'
}
