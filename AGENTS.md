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

### 改完逻辑必须重新构建便携版 exe

`pnpm build` 只更新 `app/dist/` 与 `app/dist-electron/`，**不会**动 `app/release/渠道分包工具-<版本>.exe`。不重新构建的话，从 `app/release/` 打开的永远是上一版。

所以每次改完渲染层或主进程的逻辑，都要在 `app/` 下跑一次：

```powershell
cd app
.\node_modules\.bin\electron-builder.CMD --win portable
```

本机不能用 `pnpm dist`（原因见 README「已知注意事项」）。产物约 114 MB，位于 `app/release/`，不入库。

改完至少核对一次：exe 的修改时间要晚于最后一次源码改动。

### 构建产物目录里不能放 data/

`app/release/` 是构建产物目录，而 `app/release/data/` 是便携版的数据目录 —— 只要从 `app/release/` 里双击过那个 exe，它就会在那儿当场生成一份。里面有 jks 副本、明文口令与渠道列表；`release/` 重建或清理时会被整个删掉，打包发人时也会被一起带走。

- 正常用法：把 exe 与 `data/` 一起放在仓库外的目录（例如 `桌面\渠道工具-规划原件备份\渠道分包工具\`），从那里双击使用。
- 已加一道保险：`app/electron-builder.yml` 的 `beforePack` 钩子（实现在 `app/scripts/before-pack.cjs`）检测到 `app/release/data/` 就直接中止构建。
- 真被拦下来时，按提示把 `data/` 挪到 exe 旁边，再重新构建。

