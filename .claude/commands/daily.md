---
description: 生成并发布今天的陆先生日报（政治 / 科技 / 地理与环境）
---

出一期今天的《陆先生日报》。严格遵守 SOUL.md 的人格与禁区，尤其是：只报事实不评论、
每条重要新闻交叉核验 ≥2 个独立信源、搜不到就诚实说明而不是编造。

参数（可选）：$ARGUMENTS
- 传入日期（如 `2026-09-06`）则补做那一天，否则用今天（北京时间）。
- 传入 `全自动` 则跳过发布前确认，一路推送到 GitHub 并发 Discord。

## 步骤

**1. 确定期号与日期**

日期一律按北京时间算。**不要用 `date`**：本机是欧洲中部时间，且 Git Bash 的 `TZ=` 会静默退回 UTC。
`today.js` 直接输出模板要的所有日期格式：

```bash
node scripts/today.js
ls news/ | tail -5
grep -oh 'NO\.[0-9]*' news/*.html | sort -u | tail -1
```

期号在最新一期基础上 +1，三位数字（如 `NO.003`）。同时确认 `news/YYYY-MM-DD.html`
不存在——已存在说明当天已出刊，先问我是要重做还是跳过。

**2. 搜集与核验**

用 `WebSearch` 分别搜三个板块的当日新闻（政治 / 科技 / 地理与环境），
再用 `WebFetch` 打开原文核对细节。要求：

- 每条重要新闻 ≥2 个独立信源，优先 Reuters、AP News、BBC、Al Jazeera、NHK
- 数据、时间、人名要精确到原文口径，不取整、不模糊
- 单一来源或匿名来源无法核验的，宁可不发

**3. 写稿**

- 编辑部前言：概述当日最重要的事，不评论
- 5 条头条：三个板块至少各一条
- 每个板块：1 篇深度解读（综合 5-6 个信源，时间线 + 背景）+ 3-4 条快讯
- **中英文都要写**：模板里 `.zh-content` / `.en-content` 成对出现，缺一边切到英文就是空白
- 图片用信源自带的 og:image，一律带 `loading="lazy" onerror="this.style.display='none'"`

HTML 片段的结构照抄 `news/2026-07-20.html` 里对应部分，板块类名：`pol` / `tec` / `env`。

**4. 渲染**

把各段写进一个 JSON（放临时目录，不要留在仓库里），键名见 CLAUDE.md 的占位符表：

```bash
node scripts/render.js template.html <issue.json> news/YYYY-MM-DD.html
```

`render.js` 会校验占位符是否填齐、有没有残留 `{{...}}`、图片 src 是否为空。
**报错就必须修好再继续**，不要用 `--allow-missing` 绕过。

**4.4 校验配图（必做）**

```bash
node scripts/check-images.js news/YYYY-MM-DD.html
```

它会带上本站 Referer 去真实请求每张图。**URL 能打开 ≠ 页面上能显示**：
不少图床开了防盗链（半岛电视台的 `aje.news` 就是），直接访问 200，
带 Referer 就 403，读者看到的是一片空白。2026-09-09 那期 8 张图里有 3 张栽在这上面。

报错的图：换同一条新闻里**别的信源**的图；实在找不到就不配图。
**绝不要为了凑图随便挂一张别的照片**——配错图和编造事实是一个性质。
确认没救了可以 `--fix-remove` 把坏的 img 整个删掉。

**4.5 收尾（注入分享信息 + 同步样式）**

```bash
node scripts/finalize.js news/YYYY-MM-DD.html
```

它会从刚生成的刊物里解析标题、摘要和封面图，写进 og:/twitter: 标签和 JSON-LD。
**这一步不能省**：没有这些标签，链接发到 Discord/微信里就是一条干巴巴的裸 URL。
输出里若提示「没有封面图」，说明这期一张图都没抓到，回头补图。

**5. 重建索引**

```bash
node scripts/build-index.js
```

**6. 自检后向我汇报**

打开渲染结果确认：期号/日期/星期正确、三个板块都有内容、语言切换两边都不空、
图片链接可用。然后给我一份摘要：期号、5 条头条标题、每条的信源。

**7. 发布（除非我说了"全自动"，先等我确认）**

```bash
git add -A && git commit -m "陆先生日报 YYYY-MM-DD (#NNN)" && git push
```

**8. Discord 通知（发卡片，不要发裸链接）**

卡片不用手写，从刊物直接生成，保证和正文一致、刊号不会抄错：

```bash
node scripts/make-card.js news/YYYY-MM-DD.html <card.json>
node scripts/notify-discord.js --card <card.json> --dry-run
node scripts/notify-discord.js --card <card.json>
```

需要微调时再改那份 JSON，字段说明见 `scripts/notify-discord.js` 顶部注释：

```json
{
  "author": "陆先生日报 · LUXIANSHENG DAILY",
  "title": "NO.003 · 2026年9月6日 星期日",
  "url": "https://julian-commit.github.io/daily-news-briefing/news/2026-09-06.html",
  "description": "编辑部前言压缩成两三句，不展开全文",
  "headlines": ["头条一", "头条二", "头条三", "头条四", "头条五"],
  "image": "https://…（头条配图，必须 https）",
  "color": "#c0392b",
  "footer": "交叉核验 · 事实优先 · 拒绝噪音",
  "buttons": [
    { "label": "阅读全文", "url": "https://…/news/2026-09-06.html" },
    { "label": "往期目录", "url": "https://julian-commit.github.io/daily-news-briefing/news/" }
  ]
}
```

```bash
node scripts/notify-discord.js --card <card.json> --dry-run
node scripts/notify-discord.js --card <card.json>
```

**为什么不发纯文本**：一段文字后面跟一条裸露的长 URL，视觉上跟诈骗短信一模一样。
卡片把链接藏进可点的标题和按钮里，左侧有品牌色竖条，是 Discord 的原生样式。

**9. 记账**

```bash
node scripts/journal.js --tags 日报,YYYY-MM-DD,issue-NNN --text "本期头条…；发布与推送结果…"
```

## 出问题时

- Discord 403 / code 50013 → 频道权限里给 bot 单独加 Send Messages = ALLOW（CLAUDE.md 有详细说明）
- 某个板块当天实在没有够格的新闻 → 在前言里如实说明，不凑数
- GitHub Pages 更新有几分钟延迟，push 成功后先别急着判定失败
