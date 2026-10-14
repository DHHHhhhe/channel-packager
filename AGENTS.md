<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 本项目约定

### 改完逻辑必须重新构建产物

`pnpm build` 只更新 `app/dist/` 与 `app/dist-electron/`，**不会**动 `app/release/` 下的任何产物。不重新构建的话，从 `app/release/` 打开的永远是上一版。

所以每次改完渲染层或主进程的逻辑，都要在 `app/` 下跑一次：

```powershell
cd app
.\node_modules\.bin\electron-builder.CMD --win nsis portable zip
```

本机不能用 `pnpm dist`（原因见 README「已知注意事项」）。产物都落在 `app/release/`，不入库：

| 产物 | 给谁用 | 数据目录 |
| --- | --- | --- |
| `渠道分包工具-<版本>-安装包.exe` | 发给同事安装，带自动更新 | `%LOCALAPPDATA%\渠道分包工具\data` |
| `渠道分包工具-<版本>.exe` | 便携版，双击就跑 | exe 旁边的 `data\` |
| `渠道分包工具-<版本>-解压即用.zip` | 解压后跑里面的 exe | 同上 |

版本号在 `app/package.json` 的 `version`，改完要重新构建才会进产物名与「帮助 → 版本」里。

改完至少核对一次：产物的修改时间要晚于最后一次源码改动。

要**发布一个新版本给同事**（而不是自己本地构建），用 `app/scripts/release.ps1`，见下一节。

### 自动更新：走 GitHub Releases

`app/electron-builder.yml` 的 `publish` 是 `provider: github`，构建时会写进安装包的 `resources/app-update.yml` —— 客户端只认这里，所以换发布方式必须重新构建安装包。

- 里面 `owner` / `repo` 已填成本仓库的真实值，会被原样写进安装包的 `resources/app-update.yml`。**这两个值写错，装出来的应用就查不到更新**，检查更新会报「更新服务器上找不到这个版本的信息」—— v0.2.2 就是带着占位地址发出去的，装了的机器只能手动重装。CI 构建时会用 `github.repository_owner` / `github.event.repository.name` 覆盖，所以 fork 出去也能正常发版。
- 正式发版走 `app/scripts/release.ps1`：它从 `origin` 读出账号与仓库名，用 `--config.publish.owner/repo` 覆盖，再 `--publish always` 上传。

```powershell
git remote add origin https://github.com/<账号>/<仓库>.git   # 只需一次
$env:GH_TOKEN = 'ghp_xxx'                                   # 公开仓库勾 public_repo，私有仓库勾 repo
pwsh -File app/scripts/release.ps1
```

顺序是：改 `app/package.json` 的 `version` → 跑脚本（内部先 `pnpm build`，再构建并上传）。版本号必须比线上大，同号不会被升级。上传完 Release 默认是**草稿**，客户端看不见，要去网页点 Publish。

GitHub 只接受它允许的字符做附件名，中文产物名会被换成 `channel-packager-setup-<版本>.exe`；`latest.yml` 里写的也是这个名字，两边一致，不用管。

不想在本机构建也可以推标签让 CI 发：`.github/workflows/release.yml` 在 `v<版本>` 标签上跑，用 Actions 自带的 `GITHUB_TOKEN`，只上传安装包（nsis）。仓库 Variables 里加 `EP_DRAFT=true` 就改成出草稿。

不想重新打包也能换地址：在数据目录放一份 `update.json`（内容是 `{"url":"http://内网服务器/渠道分包工具/"}`），应用启动时用它覆盖构建时的地址 —— 见 `app/src/main/updater.ts`。安装版与便携版都认这个文件。

已知限制：装好的应用把地址固化在 `app-update.yml` 里，**换地址之前装出去的旧包看不到新地址的 Release**，只能重装，或者让它读 `update.json`。

### 提交前脱敏：示例数据一律用中性值

**真实业务标识不能进仓库** —— 渠道号、应用名、公司名、包名、内部系统地址都不行。它们会同时落在四个地方，而四个地方都是公开的：

| 落点 | 为什么容易漏 |
| --- | --- |
| 代码与注释 | 写示例、占位符时顺手用了手头的真实值 |
| 提交信息 | `git log` 公开可查，别把真实渠道号写进 commit message |
| Release 正文 | 存在 GitHub 上，**不随 git 历史重写而变**，重写完要单独更新（`gh release edit`） |
| 测试与验证记录 | 贴进对话、脚本或文档里同样算外发 |

- 示例一律用项目已有的中性值：渠道号 `demo_cps_001`、后缀 `gf` / `hw`、应用名 `demo`。
- 已经提交过的，用 `git filter-repo --replace-text` 重写历史 + 强推，并同步改 Release 正文。

### 做新工具或新页面前，先读 DESIGN.md

仓库根目录的 `DESIGN.md` 是界面规范：**YAML 部分是规范性令牌**（需要精确取用时读它），
**正文部分是理由与用法**（解释这些值为什么长这样、什么情况下可以偏离）。

要生成同类工具、或往现有工具里加页面时，先读它，不要重新发明配色。

**`DESIGN.md` 是对外文件，要能独立分享。** 它里面不写本项目的信息 —— 不提工具名、
不写业务术语、不引用仓库里的路径。第 11 节那份 CSS 是给别人的落地凭据，
拿出去就该能整段粘进任何项目。往里加东西之前先问一句：外人看不懂、拿不走的内容，是不是属于这里？

本项目的令牌值来自 `app/src/renderer/src/styles/index.css`，改了那份文件要同步改规范，
**两边不一致时以代码为准**。这层对应关系只写在本文件（项目内部），不写进 `DESIGN.md`。

### 发版前或开新项目前，先读 OPEN_SOURCE.md

仓库根目录的 `OPEN_SOURCE.md` 是开源维护规范：版本号怎么抬、更新日志怎么写、发布流程、
自动更新踩过的坑、对外文案与文档的边界、发布前脱敏。

**它和 `DESIGN.md` 一样是对外文件** —— 不写本项目的信息，拿出去就能整份放进新项目。
两份的分工：

| 文件 | 管什么 |
| --- | --- |
| `DESIGN.md` | 界面长什么样（令牌、组件规格、配色） |
| `OPEN_SOURCE.md` | 怎么把它发出去、怎么长期维护（版本、日志、发布、更新） |

以后又踩到「值得记住」的坑，往对应那份补一条。这两份文档的价值全在「踩过的坑」上，
不在罗列的规则条数。

### 页面或业务逻辑一变，就发版

改了**渲染层页面**或**主进程业务逻辑**，做完直接走发版流程，不用等我单独交代一次。判据是「产物内容会不会变」：

要发版：

- 界面文案、布局、交互（`src/renderer`）
- 打包、签名、渠道写入、更新检查等实际行为（`src/main`）
- 会影响产物内容的依赖或构建配置

不发版：

- 只动了文档（README、AGENTS.md）、代码注释、`.trellis/` 记录
- 只跑了检查、没有落盘任何改动

发版流程：改 `app/package.json` 的 version → 改 `app/build/release-notes.md` → **跑 `app/scripts/sync-changelog.ps1`** → 提交 → 打标签 → 推。

那一步 sync-changelog 是干嘛的：它把本版说明并进 `app/CHANGELOG.md`，也就是界面上「更新记录」的数据源。
**漏跑的话，新版本不会出现在更新记录里**，而这件事要等到有人点开才发现。脚本是幂等的，重复跑无害。

发完按下一节的约定提醒我，不要替我装。

### 更新记录的内容来源

界面上的「更新记录」读的是 `app/CHANGELOG.md`，构建时用 `?raw` 内联进包 —— 所以断网也能看。

不走 GitHub API 是有意的：这个工具常在内网分发，从外面拉一份列表未必拿得到，而「这版改了什么」
恰恰是装不上网的那台机器更需要知道的事。

格式沿用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)：`## 版本 - 日期` 打头，下面按
`### 新增 / 优化 / 修复 / 说明` 分组。**解析器认这个结构**（`app/src/renderer/src/lib/changelog.ts`），
手改内容时别把标题层级改掉。

### 版本号：小改动只抬修订号

抬多少跟改动大小挂钩，不要一有功能就抬次版本号：

| 改动 | 抬哪一位 | 例子 |
| --- | --- | --- |
| 修 bug、调样式、加一个小功能 | **修订号** | 0.3.0 → 0.3.1 |
| 成体系的界面重构、新页面、会改变使用方式的改动 | **次版本号** | 0.2.20 → 0.3.0 |
| 不兼容的改动（数据结构、配置格式） | **主版本号** | 1.x → 2.x |

判据是「用户会不会感觉到这是一次更新」，不是「代码里加了几个函数」。

反例：只加了一个拖动手柄和一处背景修复，却抬到次版本号 —— 这类改动按上表属于修订号。

### 发完版之后：提醒一声就行，不要替我更新

版本发布完成后（CI 跑完、Release 就绪、资产核对无误），**把结果告诉我即可**，不要在本机自动触发更新或点安装。

- 本机的更新由我自己手动触发：打开应用 → 侧边栏底部「检查更新」→「下载并更新」→ 关窗口完成安装。
- 原因：自动装会在我不在电脑前的时候把正在用的版本换掉，而我可能正对着旧版排查问题，或正准备拿旧版做对照。
- 汇报要包含这三样，它们是判断「这台机器能不能升上去」的依据：版本号、Release 资产是否齐全、`latest.yml` 是否可访问。

### 构建产物目录里不能放 data/

`app/release/` 是构建产物目录，而 `app/release/data/` 是便携版的数据目录 —— 只要从 `app/release/` 里双击过那个 exe，它就会在那儿当场生成一份。里面有 jks 副本、明文口令、分组与渠道列表；`release/` 重建或清理时会被整个删掉，打包发人时也会被一起带走。

- 正常用法：把 exe 与 `data/` 一起放在仓库外的目录（例如 `D:\工具\渠道分包工具\`），从那里双击使用。
- 已加一道保险：`app/electron-builder.yml` 的 `beforePack` 钩子（实现在 `app/scripts/before-pack.cjs`）检测到 `app/release/data/` 就直接中止构建。
- 真被拦下来时，按提示把 `data/` 挪到 exe 旁边，再重新构建。

