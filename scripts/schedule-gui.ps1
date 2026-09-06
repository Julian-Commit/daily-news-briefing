# schedule-gui.ps1 — 双击「定时设置.cmd」打开的小窗口：设时间、开关闹钟。
#
# 管四个 Windows 计划任务：
#   Luxiansheng-Daily-News / Luxiansheng-Daily-Arch        每天出刊
#   Luxiansheng-Discord-Poll-News / -Arch                  每分钟看一眼 Discord
#
# 时间一律按**北京时间**填写，本机时区换算由本脚本负责（这台机器是欧洲中部时间，
# 直接按本机时间设很容易差好几个小时）。
#
# 改时间走 scripts\setup-tasks.ps1（XML 整体覆盖），不用 schtasks /Change /ST——
# 后者会弹「请输入运行身份的密码」，在窗口程序里会直接卡死。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = 'Continue'

$ROOT_NEWS = Split-Path -Parent $PSScriptRoot
$ROOT_ARCH = Join-Path (Split-Path -Parent $ROOT_NEWS) 'News Agent Architecture'
$SETUP = Join-Path $PSScriptRoot 'setup-tasks.ps1'

$TASK_NEWS = 'Luxiansheng-Daily-News'
$TASK_ARCH = 'Luxiansheng-Daily-Arch'
$TASK_POLL_NEWS = 'Luxiansheng-Discord-Poll-News'
$TASK_POLL_ARCH = 'Luxiansheng-Discord-Poll-Arch'

# ── 时区换算 ────────────────────────────────────────────────
$CST = $null
try { $CST = [System.TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time') } catch {}

function Convert-BeijingToLocal([int]$h, [int]$m) {
    if ($null -eq $CST) { return [PSCustomObject]@{ Hour = $h; Minute = $m } }
    $todayCst = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $CST).Date
    $b = $todayCst.AddHours($h).AddMinutes($m)
    $loc = ([System.TimeZoneInfo]::ConvertTimeToUtc($b, $CST)).ToLocalTime()
    return [PSCustomObject]@{ Hour = $loc.Hour; Minute = $loc.Minute }
}

function Convert-LocalToBeijing([int]$h, [int]$m) {
    if ($null -eq $CST) { return [PSCustomObject]@{ Hour = $h; Minute = $m } }
    $l = (Get-Date).Date.AddHours($h).AddMinutes($m)
    $cst = [System.TimeZoneInfo]::ConvertTime($l, [System.TimeZoneInfo]::Local, $CST)
    return [PSCustomObject]@{ Hour = $cst.Hour; Minute = $cst.Minute }
}

# ── 读写计划任务（XML 输出不受系统语言影响）──
function Get-TaskInfo([string]$name) {
    $xml = & schtasks /Query /TN $name /XML ONE 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $xml) { return $null }
    $raw = $xml -join ''
    $h = 0; $m = 0
    try {
        $doc = [xml]($xml -join "`n")
        $sb = $doc.Task.Triggers.CalendarTrigger.StartBoundary
        if ($sb) { $dt = [DateTime]::Parse($sb); $h = $dt.Hour; $m = $dt.Minute }
    } catch {}
    # 省略 <Enabled> 即为启用，只有显式 false 才算停用
    $enabled = -not ($raw -like '*<Enabled>false</Enabled>*')
    return [PSCustomObject]@{ Exists = $true; Hour = $h; Minute = $m; Enabled = $enabled }
}

function Set-DailyTimes([int]$nh, [int]$nm, [int]$ah, [int]$am) {
    if (-not (Test-Path $SETUP)) { return $false }
    $nt = '{0:00}:{1:00}' -f $nh, $nm
    $at = '{0:00}:{1:00}' -f $ah, $am
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SETUP -NewsTime $nt -ArchTime $at 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Set-TaskEnabled([string]$name, [bool]$on) {
    if ($on) { & schtasks /Change /TN $name /ENABLE 2>&1 | Out-Null }
    else { & schtasks /Change /TN $name /DISABLE 2>&1 | Out-Null }
    return ($LASTEXITCODE -eq 0)
}

# ── 界面 ────────────────────────────────────────────────────
$ink = [System.Drawing.Color]::FromArgb(26, 26, 46)
$muted = [System.Drawing.Color]::FromArgb(120, 128, 140)
$fontUI = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$fontHead = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Microsoft YaHei UI', 8)

$form = New-Object System.Windows.Forms.Form
$form.Text = '陆先生日报 · 定时设置'
$form.Size = New-Object System.Drawing.Size(470, 476)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
$form.Font = $fontUI

$banner = New-Object System.Windows.Forms.Panel
$banner.Size = New-Object System.Drawing.Size(470, 52)
$banner.Location = New-Object System.Drawing.Point(0, 0)
$banner.BackColor = $ink
$form.Controls.Add($banner)

$title = New-Object System.Windows.Forms.Label
$title.Text = '每天自动出刊'
$title.ForeColor = [System.Drawing.Color]::White
$title.Font = $fontHead
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(18, 7)
$banner.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = '时间按北京时间填写，本机时区自动换算'
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(170, 175, 190)
$subtitle.Font = $fontSmall
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(20, 30)
$banner.Controls.Add($subtitle)

function New-TaskRow($parent, $y, $label, $taskName) {
    $chk = New-Object System.Windows.Forms.CheckBox
    $chk.Text = $label
    $chk.Location = New-Object System.Drawing.Point(20, $y)
    $chk.Size = New-Object System.Drawing.Size(110, 24)
    $parent.Controls.Add($chk)

    $lblAt = New-Object System.Windows.Forms.Label
    $lblAt.Text = '北京时间'
    $lblAt.ForeColor = $muted
    $lblAt.AutoSize = $true
    $lblAt.Location = New-Object System.Drawing.Point(136, ($y + 4))
    $parent.Controls.Add($lblAt)

    $hh = New-Object System.Windows.Forms.NumericUpDown
    $hh.Minimum = 0; $hh.Maximum = 23
    $hh.Location = New-Object System.Drawing.Point(196, $y)
    $hh.Size = New-Object System.Drawing.Size(50, 24)
    $parent.Controls.Add($hh)

    $colon = New-Object System.Windows.Forms.Label
    $colon.Text = ':'
    $colon.AutoSize = $true
    $colon.Location = New-Object System.Drawing.Point(250, ($y + 4))
    $parent.Controls.Add($colon)

    $mm = New-Object System.Windows.Forms.NumericUpDown
    $mm.Minimum = 0; $mm.Maximum = 59
    $mm.Location = New-Object System.Drawing.Point(262, $y)
    $mm.Size = New-Object System.Drawing.Size(50, 24)
    $parent.Controls.Add($mm)

    $lblLocal = New-Object System.Windows.Forms.Label
    $lblLocal.ForeColor = $muted
    $lblLocal.Font = $fontSmall
    $lblLocal.AutoSize = $true
    $lblLocal.Location = New-Object System.Drawing.Point(322, ($y + 6))
    $parent.Controls.Add($lblLocal)

    $sync = {
        $loc = Convert-BeijingToLocal ([int]$hh.Value) ([int]$mm.Value)
        $lblLocal.Text = ('本机 {0:00}:{1:00}' -f $loc.Hour, $loc.Minute)
    }.GetNewClosure()
    $hh.Add_ValueChanged($sync)
    $mm.Add_ValueChanged($sync)

    return [PSCustomObject]@{ Check = $chk; Hour = $hh; Minute = $mm; Sync = $sync; Task = $taskName }
}

$rowNews = New-TaskRow $form 74 '新闻日报' $TASK_NEWS
$rowArch = New-TaskRow $form 108 '建筑日报' $TASK_ARCH

$sep = New-Object System.Windows.Forms.Label
$sep.BorderStyle = 'Fixed3D'
$sep.Location = New-Object System.Drawing.Point(20, 146)
$sep.Size = New-Object System.Drawing.Size(415, 2)
$form.Controls.Add($sep)

$lblPoll = New-Object System.Windows.Forms.Label
$lblPoll.Text = 'Discord 自动回复'
$lblPoll.Font = $fontHead
$lblPoll.ForeColor = $ink
$lblPoll.AutoSize = $true
$lblPoll.Location = New-Object System.Drawing.Point(20, 160)
$form.Controls.Add($lblPoll)

$chkPoll = New-Object System.Windows.Forms.CheckBox
$chkPoll.Text = '开启（每分钟看一眼频道；没人说话不花任何额度）'
$chkPoll.Location = New-Object System.Drawing.Point(20, 186)
$chkPoll.Size = New-Object System.Drawing.Size(420, 24)
$form.Controls.Add($chkPoll)

$lblPollNote = New-Object System.Windows.Forms.Label
$lblPollNote.Text = 'Discord 客户端没开时脚本会自己跳过，不联网、不动任何状态。'
$lblPollNote.ForeColor = $muted
$lblPollNote.Font = $fontSmall
$lblPollNote.AutoSize = $true
$lblPollNote.Location = New-Object System.Drawing.Point(38, 210)
$form.Controls.Add($lblPollNote)

$sep2 = New-Object System.Windows.Forms.Label
$sep2.BorderStyle = 'Fixed3D'
$sep2.Location = New-Object System.Drawing.Point(20, 238)
$sep2.Size = New-Object System.Drawing.Size(415, 2)
$form.Controls.Add($sep2)

$lblRun = New-Object System.Windows.Forms.Label
$lblRun.Text = '不等到点，现在就出一期：'
$lblRun.AutoSize = $true
$lblRun.Location = New-Object System.Drawing.Point(20, 252)
$form.Controls.Add($lblRun)

$btnRunNews = New-Object System.Windows.Forms.Button
$btnRunNews.Text = '跑新闻日报'
$btnRunNews.Location = New-Object System.Drawing.Point(20, 276)
$btnRunNews.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($btnRunNews)

$btnRunArch = New-Object System.Windows.Forms.Button
$btnRunArch.Text = '跑建筑日报'
$btnRunArch.Location = New-Object System.Drawing.Point(138, 276)
$btnRunArch.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($btnRunArch)

$btnLogNews = New-Object System.Windows.Forms.Button
$btnLogNews.Text = '看新闻日志'
$btnLogNews.Location = New-Object System.Drawing.Point(262, 276)
$btnLogNews.Size = New-Object System.Drawing.Size(85, 30)
$form.Controls.Add($btnLogNews)

$btnLogArch = New-Object System.Windows.Forms.Button
$btnLogArch.Text = '看建筑日志'
$btnLogArch.Location = New-Object System.Drawing.Point(352, 276)
$btnLogArch.Size = New-Object System.Drawing.Size(85, 30)
$form.Controls.Add($btnLogArch)

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20, 320)
$status.Size = New-Object System.Drawing.Size(418, 58)
$status.ForeColor = $muted
$status.Font = $fontSmall
$form.Controls.Add($status)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = '保存设置'
$btnSave.Location = New-Object System.Drawing.Point(238, 390)
$btnSave.Size = New-Object System.Drawing.Size(100, 32)
$btnSave.BackColor = $ink
$btnSave.ForeColor = [System.Drawing.Color]::White
$btnSave.FlatStyle = 'Flat'
$form.Controls.Add($btnSave)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = '关闭'
$btnClose.Location = New-Object System.Drawing.Point(346, 390)
$btnClose.Size = New-Object System.Drawing.Size(90, 32)
$form.Controls.Add($btnClose)

# ── 载入当前状态 ────────────────────────────────────────────
function Load-State {
    $missing = @()
    foreach ($row in @($rowNews, $rowArch)) {
        $info = Get-TaskInfo $row.Task
        if ($null -eq $info) {
            $missing += $row.Task
            $row.Check.Enabled = $false; $row.Hour.Enabled = $false; $row.Minute.Enabled = $false
            continue
        }
        $bj = Convert-LocalToBeijing $info.Hour $info.Minute
        $row.Hour.Value = $bj.Hour
        $row.Minute.Value = $bj.Minute
        $row.Check.Checked = $info.Enabled
        & $row.Sync
    }
    $p = Get-TaskInfo $TASK_POLL_NEWS
    if ($null -eq $p) { $chkPoll.Enabled = $false; $missing += $TASK_POLL_NEWS }
    else { $chkPoll.Checked = $p.Enabled }

    $now = Get-Date
    $bjNow = if ($CST) { [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $CST) } else { $now }
    $lines = @("现在：本机 $($now.ToString('HH:mm'))　·　北京 $($bjNow.ToString('HH:mm'))")
    if ($missing.Count) { $lines += "找不到这些任务：$($missing -join '、')" }
    else { $lines += '四个计划任务都在。改完记得点「保存设置」。' }
    $lines += '错过启动时间会在下次开机可用时补跑。'
    $status.Text = $lines -join "`r`n"
}

# ── 事件 ────────────────────────────────────────────────────
$btnSave.Add_Click({
    $btnSave.Enabled = $false
    $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    $msgs = @()
    try {
        # 先一次性写好两个日报的时间（XML 覆盖会把 Enabled 重置为启用），
        # 再统一设开关——顺序反了会把刚设的"停用"冲掉。
        if ($rowNews.Hour.Enabled -and $rowArch.Hour.Enabled) {
            $ln = Convert-BeijingToLocal ([int]$rowNews.Hour.Value) ([int]$rowNews.Minute.Value)
            $la = Convert-BeijingToLocal ([int]$rowArch.Hour.Value) ([int]$rowArch.Minute.Value)
            if (Set-DailyTimes $ln.Hour $ln.Minute $la.Hour $la.Minute) {
                $msgs += ('新闻日报：北京 {0:00}:{1:00}（本机 {2:00}:{3:00}）' -f [int]$rowNews.Hour.Value, [int]$rowNews.Minute.Value, $ln.Hour, $ln.Minute)
                $msgs += ('建筑日报：北京 {0:00}:{1:00}（本机 {2:00}:{3:00}）' -f [int]$rowArch.Hour.Value, [int]$rowArch.Minute.Value, $la.Hour, $la.Minute)
            } else {
                $msgs += '⚠ 时间没改成功，试试用管理员身份重开本窗口'
            }
        }

        foreach ($row in @($rowNews, $rowArch)) {
            if (-not $row.Check.Enabled) { continue }
            Set-TaskEnabled $row.Task $row.Check.Checked | Out-Null
            $msgs += ('{0}：{1}' -f $row.Check.Text, $(if ($row.Check.Checked) { '已启用' } else { '已停用' }))
        }

        if ($chkPoll.Enabled) {
            Set-TaskEnabled $TASK_POLL_NEWS $chkPoll.Checked | Out-Null
            Set-TaskEnabled $TASK_POLL_ARCH $chkPoll.Checked | Out-Null
            $msgs += ('Discord 自动回复：{0}' -f $(if ($chkPoll.Checked) { '已开启' } else { '已关闭' }))
        }
    } catch {
        $msgs += ('出错：' + $_.Exception.Message)
    } finally {
        $form.Cursor = [System.Windows.Forms.Cursors]::Default
        $btnSave.Enabled = $true
    }
    [System.Windows.Forms.MessageBox]::Show(($msgs -join "`r`n"), '已保存', 'OK', 'Information') | Out-Null
    Load-State
})

$runNow = {
    param($taskName, $label)
    $ans = [System.Windows.Forms.MessageBox]::Show(
        "现在就跑一期$label？`r`n`r`n它会真的搜新闻、生成网页、推送到 GitHub 并发 Discord，大概几分钟到十几分钟。",
        '确认', 'YesNo', 'Question')
    if ($ans -ne 'Yes') { return }
    & schtasks /Run /TN $taskName 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        [System.Windows.Forms.MessageBox]::Show("已经开始跑了。`r`n过几分钟点「看日志」可以看进度。", '已启动', 'OK', 'Information') | Out-Null
    } else {
        [System.Windows.Forms.MessageBox]::Show('启动失败，请检查任务是否存在。', '出错', 'OK', 'Error') | Out-Null
    }
}

$btnRunNews.Add_Click({ & $runNow $TASK_NEWS '新闻日报' })
$btnRunArch.Add_Click({ & $runNow $TASK_ARCH '建筑日报' })

$openLog = {
    param($root)
    $dir = Join-Path $root 'logs'
    if (-not (Test-Path $dir)) {
        [System.Windows.Forms.MessageBox]::Show('还没有日志——说明这个项目一次都还没自动跑过。', '没有日志', 'OK', 'Information') | Out-Null
        return
    }
    $latest = Get-ChildItem -Path $dir -Filter 'daily-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { Start-Process notepad.exe $latest.FullName } else { Start-Process explorer.exe $dir }
}

$btnLogNews.Add_Click({ & $openLog $ROOT_NEWS })
$btnLogArch.Add_Click({ & $openLog $ROOT_ARCH })
$btnClose.Add_Click({ $form.Close() })

Load-State
[void]$form.ShowDialog()
