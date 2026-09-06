# schedule-gui.ps1 — 双击「定时设置.cmd」打开的控制板。
#
# 能改的东西：
#   · 两份日报每天几点出（按北京时间填，本机时区自动换算）
#   · 每日任务、Discord 轮询的开关
#   · 轮询间隔（几分钟看一次频道）
#   · 每小时最多回复几条
#   · 谁能触发 AI 回复（白名单，可从最近发言的人里直接挑）
#
# 分工：
#   时间/间隔/开关 → 写进 Windows 计划任务（走 setup-tasks.ps1 的 XML 覆盖，
#     不用 schtasks /Change /ST，后者会弹密码框把窗口卡死）
#   上限/白名单     → 写进两个项目的 .env，poll-discord.js 启动时读取

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = 'Continue'

$ROOT_NEWS = Split-Path -Parent $PSScriptRoot
$ROOT_ARCH = Join-Path (Split-Path -Parent $ROOT_NEWS) 'News Agent Architecture'
$SETUP = Join-Path $PSScriptRoot 'setup-tasks.ps1'
$ENV_FILES = @((Join-Path $ROOT_NEWS '.env'), (Join-Path $ROOT_ARCH '.env'))

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
    $loc = ([System.TimeZoneInfo]::ConvertTimeToUtc($todayCst.AddHours($h).AddMinutes($m), $CST)).ToLocalTime()
    return [PSCustomObject]@{ Hour = $loc.Hour; Minute = $loc.Minute }
}

function Convert-LocalToBeijing([int]$h, [int]$m) {
    if ($null -eq $CST) { return [PSCustomObject]@{ Hour = $h; Minute = $m } }
    $cst = [System.TimeZoneInfo]::ConvertTime((Get-Date).Date.AddHours($h).AddMinutes($m), [System.TimeZoneInfo]::Local, $CST)
    return [PSCustomObject]@{ Hour = $cst.Hour; Minute = $cst.Minute }
}

# ── 计划任务 ────────────────────────────────────────────────
function Get-TaskInfo([string]$name) {
    $xml = & schtasks /Query /TN $name /XML ONE 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $xml) { return $null }
    $raw = $xml -join ''
    $h = 0; $m = 0; $poll = 0
    try {
        $doc = [xml]($xml -join "`n")
        $sb = $doc.Task.Triggers.CalendarTrigger.StartBoundary
        if ($sb) { $dt = [DateTime]::Parse($sb); $h = $dt.Hour; $m = $dt.Minute }
        $iv = [string]($doc.Task.Triggers.TimeTrigger.Repetition.Interval)
        $mm = [regex]::Match($iv, '^PT(\d+)M$')
        if ($mm.Success) { $poll = [int]$mm.Groups[1].Value }
    } catch {}
    # 省略 <Enabled> 即为启用，只有显式 false 才算停用
    $enabled = -not ($raw -like '*<Enabled>false</Enabled>*')
    return [PSCustomObject]@{ Hour = $h; Minute = $m; Poll = $poll; Enabled = $enabled }
}

function Set-TaskEnabled([string]$name, [bool]$on) {
    if ($on) { & schtasks /Change /TN $name /ENABLE 2>&1 | Out-Null }
    else { & schtasks /Change /TN $name /DISABLE 2>&1 | Out-Null }
    return ($LASTEXITCODE -eq 0)
}

function Save-Schedule([int]$nh, [int]$nm, [int]$ah, [int]$am, [int]$poll) {
    if (-not (Test-Path $SETUP)) { return $false }
    $nt = '{0:00}:{1:00}' -f $nh, $nm
    $at = '{0:00}:{1:00}' -f $ah, $am
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SETUP -NewsTime $nt -ArchTime $at -PollMinutes $poll 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# ── .env 读写（两个项目保持一致）────────────────────────────
function Get-EnvValue([string]$key) {
    foreach ($f in $ENV_FILES) {
        if (-not (Test-Path $f)) { continue }
        foreach ($line in [System.IO.File]::ReadAllLines($f)) {
            $m = [regex]::Match($line, '^\s*' + [regex]::Escape($key) + '\s*=\s*(.*)$')
            if ($m.Success) { return $m.Groups[1].Value.Trim() }
        }
    }
    return $null
}

function Set-EnvValue([string]$key, [string]$value) {
    $ok = $true
    foreach ($f in $ENV_FILES) {
        if (-not (Test-Path $f)) { $ok = $false; continue }
        $lines = [System.IO.File]::ReadAllLines($f)
        $found = $false
        $out = New-Object System.Collections.Generic.List[string]
        foreach ($line in $lines) {
            if ([regex]::IsMatch($line, '^\s*' + [regex]::Escape($key) + '\s*=')) {
                $out.Add($key + '=' + $value); $found = $true
            } else { $out.Add($line) }
        }
        if (-not $found) { $out.Add($key + '=' + $value) }
        try {
            [System.IO.File]::WriteAllLines($f, $out, (New-Object System.Text.UTF8Encoding($false)))
        } catch { $ok = $false }
    }
    return $ok
}

# 最近在频道里说过话的人（轮询器记录的），用来给白名单当候选
function Get-SeenUsers {
    $map = @{}
    foreach ($root in @($ROOT_NEWS, $ROOT_ARCH)) {
        $f = Join-Path $root '.discord-poll-state.json'
        if (-not (Test-Path $f)) { continue }
        try {
            $j = Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($null -eq $j.seen) { continue }
            foreach ($p in $j.seen.PSObject.Properties) { $map[$p.Name] = $p.Value.name }
        } catch {}
    }
    return $map
}

# ── 界面 ────────────────────────────────────────────────────
$ink = [System.Drawing.Color]::FromArgb(26, 26, 46)
$muted = [System.Drawing.Color]::FromArgb(120, 128, 140)
$fontUI = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$fontHead = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font('Microsoft YaHei UI', 8)

$form = New-Object System.Windows.Forms.Form
$form.Text = '陆先生日报 · 控制板'
$form.Size = New-Object System.Drawing.Size(480, 660)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::White
$form.Font = $fontUI

$banner = New-Object System.Windows.Forms.Panel
$banner.Size = New-Object System.Drawing.Size(480, 52)
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

$rowNews = New-TaskRow $form 70 '新闻日报' $TASK_NEWS
$rowArch = New-TaskRow $form 104 '建筑日报' $TASK_ARCH

$sep = New-Object System.Windows.Forms.Label
$sep.BorderStyle = 'Fixed3D'
$sep.Location = New-Object System.Drawing.Point(20, 140)
$sep.Size = New-Object System.Drawing.Size(425, 2)
$form.Controls.Add($sep)

$lblPoll = New-Object System.Windows.Forms.Label
$lblPoll.Text = 'Discord 自动回复'
$lblPoll.Font = $fontHead
$lblPoll.ForeColor = $ink
$lblPoll.AutoSize = $true
$lblPoll.Location = New-Object System.Drawing.Point(20, 152)
$form.Controls.Add($lblPoll)

$chkPoll = New-Object System.Windows.Forms.CheckBox
$chkPoll.Text = '开启（Discord 客户端没开时会自己跳过，不联网）'
$chkPoll.Location = New-Object System.Drawing.Point(20, 178)
$chkPoll.Size = New-Object System.Drawing.Size(420, 24)
$form.Controls.Add($chkPoll)

$lblEvery = New-Object System.Windows.Forms.Label
$lblEvery.Text = '每'
$lblEvery.AutoSize = $true
$lblEvery.Location = New-Object System.Drawing.Point(38, 210)
$form.Controls.Add($lblEvery)

$numPoll = New-Object System.Windows.Forms.NumericUpDown
$numPoll.Minimum = 1; $numPoll.Maximum = 60
$numPoll.Location = New-Object System.Drawing.Point(60, 206)
$numPoll.Size = New-Object System.Drawing.Size(52, 24)
$form.Controls.Add($numPoll)

$lblEvery2 = New-Object System.Windows.Forms.Label
$lblEvery2.Text = '分钟看一次'
$lblEvery2.AutoSize = $true
$lblEvery2.Location = New-Object System.Drawing.Point(116, 210)
$form.Controls.Add($lblEvery2)

$lblCap = New-Object System.Windows.Forms.Label
$lblCap.Text = '每小时最多回'
$lblCap.AutoSize = $true
$lblCap.Location = New-Object System.Drawing.Point(220, 210)
$form.Controls.Add($lblCap)

$numCap = New-Object System.Windows.Forms.NumericUpDown
$numCap.Minimum = 1; $numCap.Maximum = 60
$numCap.Location = New-Object System.Drawing.Point(304, 206)
$numCap.Size = New-Object System.Drawing.Size(52, 24)
$form.Controls.Add($numCap)

$lblCap2 = New-Object System.Windows.Forms.Label
$lblCap2.Text = '条'
$lblCap2.AutoSize = $true
$lblCap2.Location = New-Object System.Drawing.Point(360, 210)
$form.Controls.Add($lblCap2)

$lblNote = New-Object System.Windows.Forms.Label
$lblNote.Text = '没人说话时只发一个请求就退出，不消耗任何额度；上限是防刷屏和自我循环的兜底。'
$lblNote.ForeColor = $muted
$lblNote.Font = $fontSmall
$lblNote.AutoSize = $true
$lblNote.Location = New-Object System.Drawing.Point(38, 236)
$form.Controls.Add($lblNote)

$lblWl = New-Object System.Windows.Forms.Label
$lblWl.Text = '谁能触发 AI 回复（其他人只收到一句固定引导语）'
$lblWl.AutoSize = $true
$lblWl.Location = New-Object System.Drawing.Point(20, 264)
$form.Controls.Add($lblWl)

$lstWl = New-Object System.Windows.Forms.ListBox
$lstWl.Location = New-Object System.Drawing.Point(20, 288)
$lstWl.Size = New-Object System.Drawing.Size(280, 80)
$form.Controls.Add($lstWl)

$btnWlPick = New-Object System.Windows.Forms.Button
$btnWlPick.Text = '从最近发言者选'
$btnWlPick.Location = New-Object System.Drawing.Point(308, 288)
$btnWlPick.Size = New-Object System.Drawing.Size(137, 26)
$form.Controls.Add($btnWlPick)

$btnWlAdd = New-Object System.Windows.Forms.Button
$btnWlAdd.Text = '手动输入 ID'
$btnWlAdd.Location = New-Object System.Drawing.Point(308, 316)
$btnWlAdd.Size = New-Object System.Drawing.Size(137, 26)
$form.Controls.Add($btnWlAdd)

$btnWlDel = New-Object System.Windows.Forms.Button
$btnWlDel.Text = '移除选中'
$btnWlDel.Location = New-Object System.Drawing.Point(308, 344)
$btnWlDel.Size = New-Object System.Drawing.Size(137, 26)
$form.Controls.Add($btnWlDel)

$sep2 = New-Object System.Windows.Forms.Label
$sep2.BorderStyle = 'Fixed3D'
$sep2.Location = New-Object System.Drawing.Point(20, 382)
$sep2.Size = New-Object System.Drawing.Size(425, 2)
$form.Controls.Add($sep2)

$lblRun = New-Object System.Windows.Forms.Label
$lblRun.Text = '不等到点，现在就出一期：'
$lblRun.AutoSize = $true
$lblRun.Location = New-Object System.Drawing.Point(20, 394)
$form.Controls.Add($lblRun)

$btnRunNews = New-Object System.Windows.Forms.Button
$btnRunNews.Text = '跑新闻日报'
$btnRunNews.Location = New-Object System.Drawing.Point(20, 418)
$btnRunNews.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($btnRunNews)

$btnRunArch = New-Object System.Windows.Forms.Button
$btnRunArch.Text = '跑建筑日报'
$btnRunArch.Location = New-Object System.Drawing.Point(138, 418)
$btnRunArch.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($btnRunArch)

$btnLogNews = New-Object System.Windows.Forms.Button
$btnLogNews.Text = '看新闻日志'
$btnLogNews.Location = New-Object System.Drawing.Point(256, 418)
$btnLogNews.Size = New-Object System.Drawing.Size(92, 30)
$form.Controls.Add($btnLogNews)

$btnLogArch = New-Object System.Windows.Forms.Button
$btnLogArch.Text = '看建筑日志'
$btnLogArch.Location = New-Object System.Drawing.Point(353, 418)
$btnLogArch.Size = New-Object System.Drawing.Size(92, 30)
$form.Controls.Add($btnLogArch)

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20, 460)
$status.Size = New-Object System.Drawing.Size(425, 74)
$status.ForeColor = $muted
$status.Font = $fontSmall
$form.Controls.Add($status)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = '保存设置'
$btnSave.Location = New-Object System.Drawing.Point(245, 570)
$btnSave.Size = New-Object System.Drawing.Size(100, 32)
$btnSave.BackColor = $ink
$btnSave.ForeColor = [System.Drawing.Color]::White
$btnSave.FlatStyle = 'Flat'
$form.Controls.Add($btnSave)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = '关闭'
$btnClose.Location = New-Object System.Drawing.Point(353, 570)
$btnClose.Size = New-Object System.Drawing.Size(92, 32)
$form.Controls.Add($btnClose)

# ── 白名单条目：显示成「名字 (id)」，取值时再抠出 id ────────
function Format-WlItem([string]$id, $names) {
    $n = $null
    if ($names -and $names.ContainsKey($id)) { $n = $names[$id] }
    if ($n) { return ($n + '  (' + $id + ')') }
    return $id
}
function Get-WlIds {
    $ids = @()
    foreach ($item in $lstWl.Items) {
        $m = [regex]::Match([string]$item, '(\d{5,25})\s*\)?\s*$')
        if ($m.Success) { $ids += $m.Groups[1].Value }
    }
    return $ids
}

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
    if ($null -eq $p) {
        $chkPoll.Enabled = $false; $numPoll.Enabled = $false; $missing += $TASK_POLL_NEWS
    } else {
        $chkPoll.Checked = $p.Enabled
        if ($p.Poll -ge 1 -and $p.Poll -le 60) { $numPoll.Value = $p.Poll }
    }

    $cap = Get-EnvValue 'DISCORD_MAX_REPLIES_PER_HOUR'
    if ($cap -and [int]::TryParse($cap, [ref]$null)) {
        $v = [int]$cap
        if ($v -ge 1 -and $v -le 60) { $numCap.Value = $v }
    } else { $numCap.Value = 6 }

    $names = Get-SeenUsers
    $lstWl.Items.Clear()
    $wl = Get-EnvValue 'DISCORD_AI_ALLOWLIST'
    if ($null -eq $wl) { $wl = '1381233053397028936' }   # 脚本里的兜底默认值
    foreach ($id in ($wl -split ',')) {
        $id = $id.Trim()
        if ($id) { [void]$lstWl.Items.Add((Format-WlItem $id $names)) }
    }

    $now = Get-Date
    $bjNow = if ($CST) { [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $CST) } else { $now }
    $lines = @("现在：本机 $($now.ToString('HH:mm'))　·　北京 $($bjNow.ToString('HH:mm'))")
    if ($missing.Count) { $lines += "找不到这些任务：$($missing -join '、')" }
    else { $lines += '四个计划任务都在。改完点「保存设置」才生效。' }
    $lines += '错过启动时间会在下次开机可用时补跑；上限与白名单写在两个项目的 .env 里。'
    $status.Text = $lines -join "`r`n"
}

# ── 事件 ────────────────────────────────────────────────────
$btnWlPick.Add_Click({
    $names = Get-SeenUsers
    $have = Get-WlIds
    $cands = @()
    foreach ($k in $names.Keys) { if ($have -notcontains $k) { $cands += $k } }
    if (-not $cands.Count) {
        [System.Windows.Forms.MessageBox]::Show(
            "还没有可选的人。`r`n`r`n轮询器只记录「在频道里说过话」的人。让对方在频道里发一句，等一分钟再来点这个按钮。",
            '暂无候选', 'OK', 'Information') | Out-Null
        return
    }
    $pick = New-Object System.Windows.Forms.Form
    $pick.Text = '最近在频道里说过话的人'
    $pick.Size = New-Object System.Drawing.Size(360, 300)
    $pick.StartPosition = 'CenterParent'
    $pick.FormBorderStyle = 'FixedDialog'
    $pick.Font = $fontUI
    $lb = New-Object System.Windows.Forms.ListBox
    $lb.Location = New-Object System.Drawing.Point(14, 14)
    $lb.Size = New-Object System.Drawing.Size(316, 190)
    foreach ($id in $cands) { [void]$lb.Items.Add((Format-WlItem $id $names)) }
    $pick.Controls.Add($lb)
    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = '加入白名单'; $ok.Location = New-Object System.Drawing.Point(150, 214); $ok.Size = New-Object System.Drawing.Size(100, 30)
    $ok.DialogResult = 'OK'
    $pick.Controls.Add($ok)
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = '取消'; $cancel.Location = New-Object System.Drawing.Point(258, 214); $cancel.Size = New-Object System.Drawing.Size(72, 30)
    $cancel.DialogResult = 'Cancel'
    $pick.Controls.Add($cancel)
    $pick.AcceptButton = $ok; $pick.CancelButton = $cancel
    if ($pick.ShowDialog() -eq 'OK' -and $lb.SelectedItem) { [void]$lstWl.Items.Add($lb.SelectedItem) }
})

$btnWlAdd.Add_Click({
    $v = [Microsoft.VisualBasic.Interaction]::InputBox(
        "粘贴 Discord 用户 ID（一串 17-20 位数字）。`r`n`r`n怎么拿：Discord 设置 → 高级 → 打开「开发者模式」，然后右键那个人 → 复制用户 ID。",
        '添加白名单', '')
    $v = ($v -as [string]).Trim()
    if (-not $v) { return }
    if ($v -notmatch '^\d{5,25}$') {
        [System.Windows.Forms.MessageBox]::Show('这不像用户 ID——应该是一串纯数字。', '格式不对', 'OK', 'Warning') | Out-Null
        return
    }
    if ((Get-WlIds) -contains $v) {
        [System.Windows.Forms.MessageBox]::Show('这个人已经在名单里了。', '重复', 'OK', 'Information') | Out-Null
        return
    }
    [void]$lstWl.Items.Add((Format-WlItem $v (Get-SeenUsers)))
})

$btnWlDel.Add_Click({
    if ($null -eq $lstWl.SelectedItem) {
        [System.Windows.Forms.MessageBox]::Show('先在左边点一下要移除的那行。', '没选中', 'OK', 'Information') | Out-Null
        return
    }
    $lstWl.Items.Remove($lstWl.SelectedItem)
})

$btnSave.Add_Click({
    $btnSave.Enabled = $false
    $form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
    $msgs = @()
    try {
        # 先一次写好时间与间隔（XML 覆盖会把 Enabled 重置为启用），
        # 再统一设开关——顺序反了会把刚设的「停用」冲掉。
        if ($rowNews.Hour.Enabled -and $rowArch.Hour.Enabled) {
            $ln = Convert-BeijingToLocal ([int]$rowNews.Hour.Value) ([int]$rowNews.Minute.Value)
            $la = Convert-BeijingToLocal ([int]$rowArch.Hour.Value) ([int]$rowArch.Minute.Value)
            if (Save-Schedule $ln.Hour $ln.Minute $la.Hour $la.Minute ([int]$numPoll.Value)) {
                $msgs += ('新闻日报：北京 {0:00}:{1:00}（本机 {2:00}:{3:00}）' -f [int]$rowNews.Hour.Value, [int]$rowNews.Minute.Value, $ln.Hour, $ln.Minute)
                $msgs += ('建筑日报：北京 {0:00}:{1:00}（本机 {2:00}:{3:00}）' -f [int]$rowArch.Hour.Value, [int]$rowArch.Minute.Value, $la.Hour, $la.Minute)
                $msgs += ('轮询间隔：每 {0} 分钟' -f [int]$numPoll.Value)
            } else {
                $msgs += 'x 时间/间隔没改成功，试试用管理员身份重开本窗口'
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

        if (Set-EnvValue 'DISCORD_MAX_REPLIES_PER_HOUR' ([string][int]$numCap.Value)) {
            $msgs += ('每小时上限：{0} 条' -f [int]$numCap.Value)
        } else { $msgs += 'x 上限没写进 .env（文件不存在？）' }

        $ids = Get-WlIds
        if (Set-EnvValue 'DISCORD_AI_ALLOWLIST' ($ids -join ',')) {
            if ($ids.Count) { $msgs += ('AI 白名单：{0} 人' -f $ids.Count) }
            else { $msgs += 'AI 白名单：空——所有人都只会收到固定引导语' }
        } else { $msgs += 'x 白名单没写进 .env（文件不存在？）' }
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
