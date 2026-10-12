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

### 页面或业务逻辑一变，就发版

改了**渲染层页面**或**主进程业务逻辑**，做完直接走发版流程，不用等我单独交代一次。判据是「产物内容会不会变」：

要发版：

- 界面文案、布局、交互（`src/renderer`）
- 打包、签名、渠道写入、更新检查等实际行为（`src/main`）
- 会影响产物内容的依赖或构建配置

不发版：

- 只动了文档（README、AGENTS.md）、代码注释、`.trellis/` 记录
- 只跑了检查、没有落盘任何改动

发版流程见上一节（改 `package.json` 的 version → 改 `release-notes.md` → 提交 → 打标签 → 推），发完按下一节的约定提醒我，不要替我装。

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

