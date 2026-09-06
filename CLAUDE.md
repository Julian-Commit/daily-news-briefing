# CLAUDE.md — 陆先生日报（daily-news-briefing）

本项目原先运行在 Cherry Studio（CherryClaw）中，现已适配 Claude Code。
人格与用户档案由下面两个文件定义，每次会话自动加载：

@SOUL.md
@USER.md

## 一句话说明

每天生成一期中英双语新闻日报 HTML，推送到 GitHub Pages，并向 Discord 频道发一条通知。

- 仓库：`https://github.com/Julian-Commit/daily-news-briefing`
- 线上地址：`https://julian-commit.github.io/daily-news-briefing/`
- 板块：全球政治 / 科技 / 地理与环境（**不再有"财经"板块**，2026-07 已替换）

## 目录结构

```
index.html          站点首页（指向最新一期 + 往期目录，由脚本生成）
template.html       日报模板，中英双语同页切换，占位符为 {{...}}
news/YYYY-MM-DD.html  每期日报
news/index.html     往期目录（由脚本生成，不要手写）
scripts/            无第三方依赖，Node 18+ 直接跑
memory/JOURNAL.jsonl  运行日志，每期发布后追加一条
SOUL.md / USER.md   人格与用户档案
```

## 每天怎么跑

直接输入 `/daily`（定义在 `.claude/commands/daily.md`），会走完整流程。
手动执行时，顺序与关键命令如下：

1. **搜集** — 用 `WebSearch` 搜三个板块当日新闻，用 `WebFetch` 读原文核验。
   每条重要新闻必须有 ≥2 个独立信源（见 SOUL.md 第 3 条）。
2. **写稿** — 5 条头条（三板块至少各一）+ 每板块 1 篇深度解读 + 3-4 条快讯 + 编辑部前言。
   中英双语都要写：模板里 `.zh-content` / `.en-content` 成对出现，缺一个会导致切到英文时空白。
3. **填模板** — 把各段 HTML 片段写进一个 JSON，然后：
   ```
   node scripts/render.js template.html /tmp/issue.json news/2026-09-06.html
   ```
   `render.js` 会**强制校验**：占位符没填齐、渲染后还残留 `{{...}}`、`<img src>` 为空，都会报错退出。
4. **更新索引** — `node scripts/build-index.js`（重写 `news/index.html` 和根 `index.html`）。
5. **发布** — `git add -A && git commit -m "陆先生日报 2026-09-06 (#003)" && git push`。
6. **通知** — `node scripts/notify-discord.js --file /tmp/discord.txt`（token 从环境变量读，见下）。
7. **记账** — `node scripts/journal.js --tags 日报,2026-09-06 --text "本期要点…"`。

## 模板占位符

| 占位符 | 内容 | 示例 |
|---|---|---|
| `{{DATE}}` | ISO 日期，用于 `<title>` | `2026-09-06` |
| `{{DATE_EN}}` | 点分日期，页眉用 | `2026.09.06` |
| `{{WEEKDAY}}` | 英文星期，全大写 | `SATURDAY` |
| `{{ISSUE}}` | 期号，`NO.` + 三位数字，逐期递增 | `NO.003` |
| `{{PREFACE_ZH}}` / `{{PREFACE_EN}}` | 编辑部前言，中/英各一段纯文本 | |
| `{{HEADLINES_CARDS}}` | 5 张头条卡片的 HTML | 见下 |
| `{{POLITICS_FEATURE}}` `{{TECH_FEATURE}}` `{{ENVIRONMENT_FEATURE}}` | 各板块深度解读卡片 HTML | |
| `{{POLITICS_NEWS}}` `{{TECH_NEWS}}` `{{ENVIRONMENT_NEWS}}` | 各板块 3-4 条快讯 HTML（外层 `.ngrid` 模板里已有） | |

板块的 CSS 类名：政治 `pol`、科技 `tec`、地理与环境 `env`。写 HTML 片段时照抄
`news/2026-07-20.html` 里对应结构最省事——那是当前模板的正确样例。

图片一律带 `loading="lazy" onerror="this.style.display='none'"`，防止外链失效时页面破版。

## Cherry Studio → Claude Code 工具对照

| 原来 | 现在 |
|---|---|
| Exa `web_search` / `web_fetch` | `WebSearch` / `WebFetch` |
| `mcp__claw__notify`（走 DM） | `node scripts/notify-discord.js`（走频道 REST API） |
| Cherry Studio Cron `0 13 * * *` | Claude 计划任务，或 GitHub Actions（见"定时"） |
| CherryClaw 的 memory journal | `node scripts/journal.js`，写同一个 `memory/JOURNAL.jsonl` |
| `.claude/skills/` 里的软链接 | 指向 Cherry Studio 安装目录，Claude Code 不需要，已在 .gitignore 中忽略 |

## Discord 通知

需要两个环境变量（**不要写进 prompt 或提交进仓库**，Discord 会自动吊销泄露的 token）：

```
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ID=...
```

放在仓库根目录 `.env`（已 gitignore），`notify-discord.js` 会自己读取。参考 `.env.example`。

历史踩坑（2026-07-19，详见 memory/JOURNAL.jsonl）：

- **50013 Missing Permissions**：频道权限里 `@everyone` 的 SEND_MESSAGES 被 DENY，bot 没有独立 ALLOW 覆盖就会继承 DENY。修复方式是在频道权限中给 bot 单独加 "Send Messages" = ALLOW。
- **换行符**：消息里的换行必须由 JSON 序列化处理，不要手拼 JSON 字符串。`notify-discord.js` 用 `JSON.stringify` + `--file` 读文本，已规避。
- Discord 用 `allowed_channel_ids`（有 n），Telegram 用 `allowed_chat_ids`（无 n），别写错。
- 通知只发链接 + 标题摘要，不展开全文（SOUL.md 工作流程第 8 条）。

## 定时

已配好 Windows 计划任务 `Luxiansheng-Daily-News`：每天本机 15:00 触发（= 北京时间 21:00），
执行 `scripts\run-daily.cmd` → `run-daily.ps1` → `claude -p "/daily 全自动"`。
用订阅额度跑，不需要 API key；日志写在 `logs/daily-<北京日期>.log`（已 gitignore）。

```powershell
schtasks /Query  /TN Luxiansheng-Daily-News /V /FO LIST   # 看状态与下次触发时间
schtasks /Run    /TN Luxiansheng-Daily-News               # 立刻手动跑一次
schtasks /Change /TN Luxiansheng-Daily-News /DISABLE      # 暂停
schtasks /Change /TN Luxiansheng-Daily-News /ENABLE       # 恢复
```

**两个前提，缺一就会在日志里失败：**

1. 这个目录必须被信任过——先交互式跑一次 `claude` 并接受信任对话框，
   否则 `.claude/settings.json` 里的权限白名单会被整个忽略，无头模式下工具调用会被拒。
2. CLI 登录态有效——OAuth 过期时 `claude -p` 直接退出，同样要交互式登录一次。

时区提醒：本机是欧洲中部时间。2026-10-25 欧洲夏令时结束后，本机 15:00 会变成北京 22:00，
仍是同一个北京日期，不影响刊号；想精确对齐就把触发时间往前挪一小时。

注意：上一期是 2026-07-20（NO.002），中间停更近两个月。重新开跑时期号从 NO.003 续。

## 一个容易踩的坑：日期

本机时区是欧洲中部时间（既不是 UTC+8 也不是纽约），而且这台机器的 Git Bash 没有时区库，
`TZ=Asia/Shanghai date` 会**静默退回 UTC**——看着像成功，日期却是错的。
取日期只用下面这个脚本，它按北京时间算，并直接给出模板要的几种格式：

```bash
node scripts/today.js              # 今天
node scripts/today.js 2026-09-06   # 补做某一天
```

## 硬性约束

- 搜不到足够新闻就诚实说明，**绝不编造**（SOUL.md 禁区）。
- 不做股市/投资建议，不评价任何国家政策，不预测事件走向。
- 发布前必须跑 `render.js`：残留占位符上线过一次就很难看。
- `news/index.html` 和根 `index.html` 由脚本生成，手改会被覆盖。
