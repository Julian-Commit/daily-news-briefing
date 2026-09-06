# 陆先生日报

> 交叉信源 · 事实优先 · 拒绝噪音

每日自动生成的全球新闻早报，覆盖国际政治、科技、地理与环境三大板块。

## 访问

🔗 **[https://julian-commit.github.io/daily-news-briefing/](https://julian-commit.github.io/daily-news-briefing/)**

## 特性

- 📰 每日精选 5 条头条 + 三大板块深度解读
- 🔍 每条重要新闻交叉核验至少两个独立信源
- 🌐 英文原文 → 高质量中文翻译，中英双语同页切换
- 📱 响应式设计，手机/平板/桌面完美显示
- ⏰ 每日北京时间 21:00 更新

## 新闻来源

Reuters · BBC · AP News · Al Jazeera · NHK · TechXplore · TechTimes · 等国际媒体

## 怎么出一期

在 Claude Code 里打开本目录，输入 `/daily`。人格与流程定义在
[CLAUDE.md](CLAUDE.md) / [SOUL.md](SOUL.md) / [USER.md](USER.md)。

手动跑或排查时用得到的命令（Node 18+，无第三方依赖）：

```bash
node scripts/today.js                                                  # 北京时间日期（模板要的格式全给）
node scripts/render.js template.html issue.json news/2026-09-06.html  # 填模板 + 校验
node scripts/build-index.js                                           # 重建首页与往期目录
node scripts/notify-discord.js --file discord.txt --dry-run           # 预览通知
node scripts/journal.js --tail 3                                      # 看最近几次运行记录
```

Discord 推送需要在仓库根目录建 `.env`（参考 `.env.example`）。

## 定时设置（不用命令行）

双击项目根目录的 **`定时设置.cmd`**，会打开一个小窗口：

- 改每天出刊时间（**按北京时间填**，本机时区自动换算）
- 一键开关「每天自动出刊」与「Discord 自动回复」
- 「立刻跑一次」不用等到点
- 「看日志」直接打开最近一次的运行记录

一个窗口同时管新闻日报和建筑日报的四个计划任务。命令行等价物是
`scripts/setup-tasks.ps1`（用 XML 重建任务，带「错过就补跑」等设置）。

## 目录

| 路径 | 说明 |
|---|---|
| `template.html` | 日报模板，占位符 `{{...}}` |
| `news/YYYY-MM-DD.html` | 每期日报 |
| `index.html` · `news/index.html` | 首页与往期目录，**由脚本生成，勿手改** |
| `scripts/` | 渲染 / 建索引 / 推送 / 记账 |
| `memory/JOURNAL.jsonl` | 运行日志 |

---

内容仅供参考
