# 实施计划：渠道分包工具 GUI 版

## 前置条件

| 项 | 状态 |
|---|---|
| Node `v24.21.0` / npm `11.19.0` | 已就绪 |
| 内置运行时 | JRE 由 `jlink` 从 Temurin JDK 17 产出；`zipalign.exe`/`apksigner.jar` 从 build-tools 37.0.0 复制；walle jar 用工作目录现有 |
| **测试用 APK** | **已就位** —— `示例应用_V1.4.6_20260916_1727.apk`（99.47 MB，3756 个条目，当前未写渠道） |
| 25 个 jks + `channelConfig.sample.json` | 已就绪，可直接作为测试素材 |

## 阶段 0：工程骨架与内置运行时

- [x] 建 `app/` 目录，用 **pnpm** 安装 `electron@44.4.5`（精确锁定）、`electron-builder`。
  - **pnpm 11 起 `.npmrc` 不再承载这些设置**：它只读认证与 registry，`node-linker` / `shamefully-hoist` 必须写进 `app/pnpm-workspace.yaml`（键名改 camelCase：`nodeLinker` / `shamefullyHoist` / `strictPeerDependencies` / `allowBuilds`）。**已实测**：写在 `.npmrc` 里会被静默忽略，`pnpm config get node-linker` 返回 `undefined`，`node_modules` 仍是符号链接。
  - **electron 44 已取消 `postinstall`**，二进制改由独立的 `install-electron` 命令下载。不显式调用就不会有 `node_modules/electron/dist/electron.exe`。故在 `package.json` 加 `"postinstall": "install-electron"`。
- [x] 装前端工具链：`vite`、`@vitejs/plugin-react`、`react`、`react-dom`、`tailwindcss`（v4）、`@tailwindcss/vite`、`vite-plugin-electron`。
- [x] 写 `app/vite.config.mts` 与 renderer 骨架（`src/renderer/index.html`、`src/main.tsx`、`App.tsx`、`styles/index.css`），再跑 shadcn init。
  - **必须叫 `vite.config.mts`**：`package.json` 没有 `"type": "module"`，`vite.config.ts` 会被当 CJS 加载，Vite 8 已就此告警（native 配置加载器转正后会直接失败）。
  - **TypeScript 7 移除了 `baseUrl`**：`paths` 必须写成相对路径（`"./src/renderer/src/*"`），否则 `tsc` 直接报 TS5102 / TS5090。
  - 入口文件命名为 `main/main.ts` 与 `preload/preload.ts`，**不能叫 `index.ts`**：两个构建都以 `[name].js` 输出到同一个 `dist-electron/`，同名会互相覆盖。另外两者都要显式设 `vite.root = app 根目录`，否则会继承外层指向 `src/renderer` 的 `root`。
- [x] `npx shadcn@latest init -t vite -b radix -p nova --css-variables -y --no-monorepo`，再 `add card dialog table badge checkbox select input label separator`，组件源码落到 `src/renderer/src/components/ui/`。
  - **CLI 参数已与规划时不同**：`-b/--base` 现在指组件库（base/radix/aria），不再是基色；`-d` 会按 next 模板新建工程，**不能用**；不传 `-p/--preset` 会停在交互式选择上。实测 `-p nova` 生成的正是 Neutral 基色 + Geist 字体，与 R22 要求一致。
  - **字体栈有坑**：init 会往 `styles/index.css` 追加 `@theme inline { --font-sans: 'Geist Variable', sans-serif }`。另起一个 `@theme` 块写中文回退会被它**覆盖**，必须直接改 `@theme inline` 里那一行，否则中文掉到系统默认字体。
- [x] 写 `app/scripts/prepare-runtime.ps1`：
  - **JRE 自行产出**：下载 Temurin JDK 17（Windows x64 zip，182 MB，带 SHA256 校验）→ 解压 → `jlink` 裁剪 → 删除临时 JDK。**不从本机任何安装复制**（本机 Java 依附 Android Studio 的 jbr，卸载即失效）。
  - 从本机 SDK 复制 `zipalign.exe` 与 `apksigner.jar`；从工作目录复制 `walle-cli-all.jar`。
  - 幂等：目标已存在且体积匹配则跳过。
- [x] 执行脚本，实测体积：JRE **30.8 MB** + zipalign 0.86 MB + apksigner 1.13 MB + walle 0.56 MB = **33.4 MB**（与预期一致）。
- [x] 加 `.gitignore`（`app/node_modules`、`app/resources/bin`、`app/dist`、`app/release`）。
- [x] 骨架冒烟通过：`pnpm build` 产出 `dist/`（renderer）与 `dist-electron/main.js`、`dist-electron/preload.js` 三个互不冲突的产物；用 `--remote-debugging-port=9222` 启动构建产物，CDP 求值确认 `#root` 已挂上 React（`h1` 文本正确），渲染进程无报错。

**骨架验证**

```powershell
pnpm typecheck
pnpm build
Get-ChildItem app\dist-electron          # 期望 main.js + preload.js（不可同名）
```

> **踩过的坑（供应链策略）**：手工把 `shadcn` 从 `dependencies` 挪到 `devDependencies`，会让 `pnpm-lock.yaml` 与 `package.json` 失配；`pnpm run` 前的依赖校验随即触发重装，而本机环境对依赖有 `minimumReleaseAge`（24 小时）策略，重装被拦下（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，6 个刚发布的传递依赖）。**结论**：`shadcn` 是被 CSS 的 `@import "shadcn/tailwind.css"` 拉进来的构建期依赖，保持注册表写入的位置即可，别手工挪分类。本工程 `electron-builder.yml` 的 `files` 只收 `dist/**`、`dist-electron/**`、`package.json`，`node_modules` 根本不进包，分类对产物无影响。

**验证**

```powershell
$bin = "app\resources\bin"
& "$bin\jre\bin\java.exe" -version
& "$bin\jre\bin\java.exe" -jar "$bin\apksigner.jar" version      # 期望: 0.9
& "$bin\jre\bin\java.exe" -jar "$bin\walle-cli-all.jar" -v       # 期望: 1.1.6
& "$bin\jre\bin\keytool.exe" -list -keystore ".\sample.jks" -storepass "sample@123"
& "$bin\zipalign.exe"                                            # 期望: Zip alignment utility
[math]::Round(((Get-ChildItem $bin -Recurse -Force -File | Measure-Object Length -Sum).Sum)/1MB,1)   # 期望 ≈ 33.4
```

> **阶段 0 实测结果**：`java 17.0.20.1`、`apksigner 0.9`、`walle 1.1.6`、`zipalign` 回显 `Zip alignment utility`、`keytool` 成功读出 `sample.jks` 的 `PrivateKeyEntry`；`bin` 合计 **33.4 MB**。182 MB 的 JDK 下载耗时 11 秒，SHA256 校验通过。`electron` 二进制 234.6 MB，`spawnSync(require('electron'), ['--version'])` 读出 `v44.4.5`。

> **`jlink` 模块集已实测确定**：`java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`。不要只信 `jdeps` 的输出 —— crypto 走反射，漏掉 `jdk.crypto.ec` 会在签名时才暴露。`jdk.jartool` 用于提供 `keytool.exe`。

## 阶段 1：运行时解析与环境自检

- [x] `src/main/runtime.ts`：`resolveBinDir()` 区分开发期（`app.getAppPath()/resources/bin`）与打包后（`process.resourcesPath/bin`，由 electron-builder 的 `extraResources` 投递）。两种布局内部一致，只有根目录需要分支。
- [x] 实现 `checkRuntime()`，返回 `{binDir, components[], ok}`，每项为 `{key, label, path, exists, sizeBytes}`。
  - **只做文件检查，不做进程探测**：启动路径上起 5 个子进程（每个约 300 ms）不值当；组件是否真能跑，交给阶段 3 的 keytool 校验和实际出包暴露。
  - **0 字节按缺失处理**：下载被截断时文件是存在的，只看 `exists` 会漏掉，一路拖到签名才炸。`sizeBytes` 顺带用于横幅展示。
- [x] `src/main/ipc/runtime.ts` 注册 `runtime:check`，`preload` 暴露 `window.api.checkRuntime()`，渲染层 `components/RuntimeBanner.tsx` 挂载时拉取，缺失项在顶部横幅列出「名称 + 期望路径 + 体积」。
  - 自检本身抛错也单独出一态，不静默吞掉 —— 否则界面看着正常，问题却没人知道。
  - 缺组件不拦窗口、不影响启动，只是出包不可用。

**验证**

```powershell
# 三次启动读界面文本：基线无横幅 → 重命名后点名缺 apksigner → 恢复后横幅消失
Rename-Item app\resources\bin\apksigner.jar apksigner.jar.bak
# 启动应用（可加 --remote-debugging-port=9222，用 CDP 求值直接取界面文本）
Rename-Item app\resources\bin\apksigner.jar.bak app\resources\bin\apksigner.jar
```

> **阶段 1 实测结果**：基线界面无横幅；重命名 `apksigner.jar` 后横幅显示「内置运行时缺失 1 项，出包功能不可用 / apksigner：`…\resources\bin\apksigner.jar`（文件不存在）」，进程存活未崩溃；恢复后横幅消失。

## 阶段 2：配置存储层

- [x] `src/main/paths.ts`：数据根目录 **`PORTABLE_EXECUTABLE_DIR` 优先**，其次打包态取 exe 所在目录。
  - **开发态不能用 `app.getPath('exe')`**（design.md 的示例代码就是这么写的）：开发时它指向 `node_modules/electron/dist/electron.exe`，数据会落进 node_modules 并被下一次重装清掉。开发态改用 `app.getAppPath()`，即 `app/data`。
  - 可写性判断真写一个探针文件再删掉，而不是 `fs.access` —— 只读介质、ACL、杀软占用都可能让它说谎。
  - `app.setPath('userData', <dataDir>/.runtime)`，否则 Chromium 缓存会另落一份到 `%APPDATA%`，便携版就不便携了。这一步必须在 ready 之前做。
  - `data/` 不可写时回退 `app.getPath('userData')/data`（回退位置要在改写 userData **之前**取，否则取到的是改写后的值），并由 `usedFallback` 上报给界面。
  - `resolveInData()` 解析相对路径并挡住 `../` 逃逸。
- [x] `src/main/store.ts`：读写 `data/jks.json`、`data/template.json`、`data/channels/<id>.json`。
  - 写入一律先写 `.tmp` 再 `rename`，中途崩溃不会把原文件截成半个 JSON。
  - JSON 坏掉或缺失一律按「还没有」处理并给默认值，不让坏文件把应用卡在启动阶段。
  - 首次启动把 `TEMPLATE_SEED` 落成 `data/template.json`，之后以文件为准。
- [x] **jks 副本导入**：复制源文件到 `data/keystores/<id>.jks`，记录 `sha256` / `fileSize` / `sourcePath`。同 `id` 且 SHA256 相同 → `duplicate` 跳过；同 `id` 但 SHA256 不同 → 退到 `<id>_2`、`<id>_3`，**不覆盖**。新增时顺手建一份空渠道文件，保证 `channels/<id>.json` 与条目一一对应。
- [x] **删除 jks**：先解析副本路径（越界即失败），再改列表，最后删副本与 `channels/<id>.json`。
- [x] **刷新**：`jks:refreshFromSource` 读 `sourcePath` 算 SHA256 比对，返回 `unchanged` / `changed` / `source-unavailable`；**只报告差异，不自动同步**。
- [x] 模板种子 `src/shared/constants/templateSeed.ts`：由 `channelConfig.sample.json` **脚本生成**（避免手抄中文别名出错），13 条 `{suffix, alias}`，已剥掉渠道前缀。固化进源码而不是运行时读文件 —— 打包后仓库文件不在，应用必须自包含。
- [x] 凭据推导 `src/shared/utils/credentials.ts`：`deriveAlias()` → `<basename>`，`derivePassword()` → `<basename>@123`。放在 shared 是因为主进程导入时用，界面预填输入框时也要用。用户只要动过别名或口令，`credentialSource` 就记成 `manual`。

**验证**

```powershell
# 模板种子应为 13 条，且 suffix 不含 demo_
node -e "const c=require('./channelConfig.sample.json');const t=c.channelInfoList.filter(x=>x.alias).map(x=>({suffix:x.channel.replace(/^demo_/,''),alias:x.alias}));console.log(t.length);console.log(t)"
```

> **阶段 2 实测结果**（用两份临时生成的测试 jks 跑完整链路，未碰真实私钥）：
>
> | 动作 | 结果 |
> |---|---|
> | `loadStore()` | `dataDir = app\data`、`usedFallback = false`、模板 13 条、`demo_` 前缀残留 0 |
> | 新增 `dir1\testkey.jks` | `added`，`id = testkey`，`keystoreFile = keystores/testkey.jks`，别名与口令推导为 `testkey` / `testkey@123`，`credentialSource = derived` |
> | 重复导入同一文件 | `duplicate`，提示「「testkey」已存在且内容相同，已跳过」 |
> | 导入 `dir2\testkey.jks`（同基名、内容不同） | `added`，`id = testkey_2` —— **未覆盖** |
> | `refreshJksFromSource` | 两份均 `unchanged`；不存在的 id 抛错 |
> | 删除 `testkey` | 副本与 `channels/testkey.json` 均消失，`testkey_2` 完好 |
>
> `data/` 目录结构实测：`jks.json` / `template.json` / `keystores/` / `channels/` / `logs/` / `.runtime/`；Chromium 缓存全部落在 `.runtime/` 内，`%APPDATA%` 下没有另起一份。
>
> **界面要注意**：主进程 handler 抛出的错误，渲染层收到的是 `Error invoking remote method '<通道名>': Error: <真正的原因>`。阶段 4 展示错误时必须把这层前缀剥掉，否则用户看到的是通道名而不是问题本身。

> **`keystoreFile` 是签名唯一路径。** 出包与 keytool 校验都只用 `data/keystores/` 下的副本，`sourcePath` 仅用于显示与刷新 —— 这是 R21 的核心，实现时别把两者混用。

## 阶段 3：凭据校验（keytool）

- [x] `cred:verify` IPC：用内置 `keytool -list -v -keystore <data/keystores 下的副本>` 校验（**不用 `sourcePath`**）。
- [x] 口令走 **`-storepass:env <变量名>`** 而不是计划里写的 `-storepass <pw>`。后者会把明文口令写进进程命令行，任务管理器和进程列表都能看到；走环境变量可以避开。已实测该参数在内置 JDK 17 上可用。
- [x] **编码问题用强制英文 locale 解决，而不是解码 GBK。** 加 `-J-Duser.language=en -J-Duser.country=US` 后输出是纯 ASCII（实测非 ASCII 字节数为 0），既不用按 GBK 解码，也不受使用者系统语言影响 —— 否则中文系统输出 GBK 中文、英文系统输出英文，解析逻辑得写两套。
  - 实测确认：裁剪后的 JRE **没有** `jdk.localedata` 模块，但 keytool 的提示语资源在 `java.base` 里，所以中文环境下确实输出 GBK 中文（`-list` 有 98 个非 ASCII 字节）。计划里"要么加 `-J-Dfile.encoding=UTF-8`，要么按 GBK 解码"这条是对的，只是强制 locale 更省事。
- [x] 解析 `Alias name:` 取真实别名。契约：`ok: true` 的语义是「口令正确，且能确定唯一可用的别名」——口令对但库里有多个条目、又对不上用户填的别名时仍算不通过，返回 `aliases` 让界面提示或选择。
- [x] 错误映射：`password was incorrect` → 口令不正确；`Keystore file does not exist` → 副本文件不存在；`UnrecoverableKeyException` → 密钥口令不正确；`Invalid keystore format` → 不是有效的 keystore 文件；其余原样透出（截断到 200 字）。
- [x] `runtime.ts` 增加 `resolveRuntimeComponentPath(key)`，keytool 路径不再各处手拼 `jre/bin/keytool.exe`。

**验证**：`sample.jks` + `sample@123` 通过；`legacy.jks` + `legacy@123` 失败并给出明确提示。

> **阶段 3 实测结果**（测试 jks 现场用内置 keytool 生成，不碰真实私钥）：
>
> | 场景 | 结果 |
> |---|---|
> | 口令正确、别名填错（库里只 1 条） | `ok: true`，别名改为 `alpha`，提示「别名「single」不在库中，已改为「alpha」」 |
> | 口令错误 | `ok: false`，「口令不正确」 |
> | 口令与别名都正确 | `ok: true`，无多余提示 |
> | 空口令 | `ok: false`，「口令不能为空」 |
> | 库中 2 条、未指定别名 | `ok: false`，「口令正确，但库中有多个条目，需要指定别名：one、two」 |
> | 库中 2 条、指定 `two` | `ok: true`，`alias = two` |
> | 库中 2 条、指定不存在的别名 | `ok: false`，列出「现有条目：one、two」 |
> | **源文件删除后校验** | **仍 `ok: true`** —— 确实只读副本，R21 成立 |
> | 源文件删除后刷新 | `source-unavailable` |
>
> **真实数据只读探测**：工作目录 25 个真实 jks 中，24 个用推导规则 `<基名>@123` 直接通过，1 个报「口令不正确」（即口令不明的那份）。失败形态只有「通过 / 口令不正确」两种，没有出现格式非法的文件 —— 说明 `derivePassword` 的推导规则在这批数据上成立，界面预填默认值可以直接用。该探测只读，未复制、未改动任何真实文件。

## 阶段 4：UI 与拖拽

- [x] `renderer/styles.css`：写入 `design.md`「设计系统」的 light/dark 令牌（CSS 变量），Tailwind v4 用 `@theme inline` 映射，shadcn/ui 组件直接消费 —— **不逐处硬编码色值**。shadcn 生成的 oklch 令牌与 `design.md` 的十六进制表逐项核对一致，未改写。
- [x] 字体栈含中文回退（`"Geist Variable", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif`）。Geist 的 Latin 子集自托管（`dist/assets/geist-latin-*.woff2`，29.4 KB），**无 CDN**。
- [x] 布局骨架对齐参考站实测值：侧边栏 `272px`、顶栏 `48px`（sticky + 底部 1px 边框）、卡片圆角 `14px`。另按 `design.md` 修了四处 shadcn 默认值与设计稿的偏差（卡片纵向内边距 12px、卡片标题 14px、表头 44px/`px-3`、单元格 `p-3`、按钮 36px、输入框圆角 8px）。
- [x] `preload/preload.ts`：`contextBridge` 暴露白名单 API，含 `webUtils.getPathForFile`。
- [x] 主界面：拖拽区 / 文件选择框 → 显示所选 APK 路径。拖拽用 `webUtils.getPathForFile`（Electron ≥32 已移除 `File.path`）；并在 `main.tsx` 全局 `preventDefault` 掉 `dragover`/`drop`，否则文件拖到窗口空白处会让 Electron 直接导航过去。
- [x] jks 列表：新增（含「套用模板」「导入 JSON」两个选项）、编辑、删除（带确认，**删副本**）。列表显示来源路径与 SHA256 前 8 位，并提供「从原文件重新导入」按钮。
- [x] 渠道列表：增删改查表格，渠道必填、别名选填；附「按模板生成」与渠道名去重校验。
- [x] 模板编辑页：独立于任何 jks，改它不影响已有副本。
- [x] 出包页：选 jks → 勾渠道 → 选输出目录（默认 `<APK 同级>\渠道包\`）→ 选签名模式 → 开始。「开始出包」按钮先置灰并提示待阶段 5 接入。
- [x] 进度区：`ProgressPanel` 只吃「阶段文案 + 原始输出行」，不预设事件结构，待阶段 5 由 `task:progress` 填充。
- [x] 密码框旁常驻明文存储提示。

**验证**：手动走查全部验收项中的界面部分；重点验证「改副本不影响模板」与「中文未掉到系统默认字体」。

> **阶段 4 实测结果**（CDP 驱动真实界面：真实鼠标事件、`DOM.setFileInputFiles` 选文件，一次性 jks 现场生成）：
>
> | 走查项 | 结果 |
> |---|---|
> | 侧边栏 / 顶栏 / 卡片圆角 / 卡片纵向内边距 / 卡片 gap / 卡片 header 左内边距 / 卡片标题字号 | `272px` / `48px` / `14px` / `12px` / `12px` / `16px` / `14px`，与设计稿逐项一致 |
> | 中文字形实际用哪个字体（宽度比对） | 中文五种写法都渲染成 `112px` —— 显式中文回退在这台机器上是保险，不是可观测差异；英文栈宽 `142.47` 与纯 Geist 完全一致、与雅黑/system-ui 的 `148.01` 不同，**确认 Latin 走的是 Geist** |
> | 模板页改两行后保存 | 保存前提示「有未保存的修改」，保存后提示消失，状态文案「模板已保存。」 |
> | 后缀重复校验 | 把后缀改成种子里已有的 `gf` 时被拦下，提示「后缀重复：gf」，未写盘 |
> | 新增 jks 选文件后自动带出 | 路径 / 显示名 `uitest.jks` / 别名 `uitest` / 口令 `uitest@123` / 应用名 `uitest` |
> | 明文存储提示 | 常驻显示 |
> | 勾「套用模板」后前缀默认值 | `uitest`（等于 jks 文件名） |
> | 新增后落库 | 表格出现 `uitest.jks`，凭据来源徽章「推导」，SHA256 前 8 位显示 |
> | 生成副本（13 条模板 × 前缀） | 渠道名 `uitest_uitest_a`、`uitest_uitest_b`、`uitest_tx_flow`…，别名与 `defaultExtraInfo.app = uitest` 均正确 |
> | 删 1 条渠道并保存 | 13 → 12，提示「渠道列表已保存。」 |
> | **改副本是否波及模板** | `template.json` 仍 **13** 条、前两条仍是 `uitest_a/走查甲`、`uitest_b/走查乙`（**未被加前缀**）；`channels/uitest.json` 12 条带前缀 —— 两者完全独立 |
> | 换掉原文件后「从原文件重新导入」 | 「原文件已变化（SHA256 7ac03395），副本未自动同步。如需更新，请删除后重新新增。」 |
> | 删除 jks 的确认框 | 标题「删除 uitest.jks」+ 说明「会同时删除 data/keystores/ 下的副本与它的渠道列表，无法撤销。原文件不受影响。」 |
> | 确认删除后 | 表格剩 0 行；`keystores/`、`channels/` 目录都空了；`jks.json` 的 `items` 为空 |
> | 页面运行时错误 | `[]`（全程无 React 报错） |
>
> **顺带修掉的字段语义 bug**：`addKeystore` 原先按「调用方有没有传 alias/storePassword」判定 `credentialSource`。界面总是先自动带出再传值，导致该字段恒为 `manual`、徽章恒显示「手工」。改为比对最终值是否等于按文件名推导的结果，徽章才正确显示「推导」。
>
> **新增时的凭据校验顺序**：R21 要求校验只读副本，而新增时副本还不存在。实现取「先建副本与条目 → 按副本校验 → 不通过就把条目与副本一起删掉」，净效果等同于没保存，既不绕过副本约束，也不会留下半条脏数据。
>
> **「导入 JSON」落在渲染层**：用 `<input type="file">` + `file.text()` 读内容，不走 IPC。K3「原样导入」照办，只取 `channelInfoList`，`defaultExtraInfo.app` 仍取该 jks 的 `app`。
>
> 这里的「导入 JSON」指**新增 jks 对话框内**的那个（只填草稿，不落盘）。「渠道配置」页另有一个同名按钮，走 `channels:import` IPC 直接写文件；后者在 2026-10-08 已改为先预览再落盘，见文末「后续增强：可用性六项」。

## 阶段 5：出包流水线

- [x] `src/main/signer.ts`：zipalign → apksigner sign → apksigner verify。
- [x] `src/main/walle.ts`：`batch2 -f` 与 `show`。**`batch -c` 未实现** —— 应用的渠道数据始终来自 `channels/<id>.json`，走的是 `batch2 -f`；命令行传渠道列表那条路径没有调用方，不凭空造一个。
- [x] `src/main/pipeline.ts`：按 `design.md` 的 7 步编排，含第 3d 步「把重签名结果还原成原包名」。
- [x] `src/main/logger.ts`：每次任务一份日志，UTF-8 落盘，**任务结束后不删除**。
- [x] 第 6 步用 `walle show` 校验产物渠道号。
- [x] 额外的 `walle:show` IPC 与出包页的「查看渠道」按钮（K7 要求保留该功能）。
- [x] 同时只允许一个出包任务；重复启动会明确拒绝，而不是让两个任务的进度互相覆盖。

**关键约束**：所有子进程用 `spawn(cmd, [args], { windowsHide: true })` 的**数组参数**形式，不拼 shell 字符串 —— 中文路径与中文文件名（`示例应用_V1.4.6_..._应用宝.apk`）必须原样传递。

**验证**

该流水线已在规划阶段用真实 APK 跑通（见 `prd.md` 的「端到端实测」），实施时按同样步骤回归：

```powershell
$J = "$bin\jre\bin\java.exe"
# 期望产物名: 示例应用_V1.4.6_20260916_1727_巨量.apk，且不带 _resigned
& $J -jar "$bin\walle-cli-all.jar" show -c "<产物路径>"   # 期望: sample_jl_flow
& $J -jar "$bin\walle-cli-all.jar" show -e "<产物路径>"   # 期望: {app=sample}
& $J -jar "$bin\apksigner.jar" verify -v "<产物路径>"      # 期望: Verifies
```

> **阶段 5 实测结果**（真实 99.5 MB APK，脱敏名 `示例应用_V1.4.6_20260916_1727.apk`，全程走界面；jks 为现场生成的一次性 `sample.jks`，别名 `sample` / 口令 `sample@123`，未复制任何真实私钥）：
>
> | 场景 | 结果 |
> |---|---|
> | 套用模板 + 前缀 `sample`，只勾「应用宝」出包 | 产物 `示例应用_V1.4.6_20260916_1727_应用宝.apk`（**与验收项逐字一致**，无 `_resigned` 残留） |
> | 界面产物表 | 文件名 / 渠道号 `sample_yyb` / 别名 `应用宝` / 校验 **通过** |
> | 独立 `walle show -c` | `sample_yyb` |
> | 独立 `walle show -e` | `{app=sample}` |
> | 独立 `apksigner verify -v` | `Verifies`；v1 / v2 / v3 均 true |
> | 出包页「查看渠道」按钮 | 「渠道号：sample_yyb ｜ 额外信息：{app=sample}」 |
> | `signMode = skip` | 同样产出 `示例应用_V1.4.6_20260916_1727_应用宝.apk`，渠道号校验通过 |
> | `_resigned.apk` 另存 | `示例应用_V1.4.6_20260916_1727_resigned.apk`（99.5 MB，在 APK 同级） |
> | 工作目录 | 成功后 `<outputDir>\.work\<taskId>` 已清空，只剩空的 `.work` 容器 |
> | 日志 | `data/logs/<taskId>.log`，3871 行、UTF-8、中文路径正常、任务结束后仍在 |
> | 告警 / 页面错误 | 均为空 |
>
> **实测踩到并修掉的两个真问题**：
>
> 1. **`walle show` 的输出格式是 `<绝对路径> : <值>` 一行**，不是只打印渠道号。原实现取整行当渠道号，导致每个产物都被判「渠道号校验未通过」。改为按 ` : ` 切分取后半段 —— 不能按最后一个冒号切，Windows 路径里的 `C:\` 也是冒号。
> 2. **java 工具与 zipalign 的输出编码要分开处理**。java 在中文 Windows 上按系统编码（GBK）写 stdout，加 `-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8` 后正常；`zipalign.exe` 是原生 C++ 程序，这三个参数对它无效，只能按 GBK 解码（`TextDecoder('gbk')`，实测可用）。修之前日志里的中文路径是 `ʾ��Ӧ��` 这样的乱码。
>
> **口令不进命令行**：apksigner 支持 `--ks-pass env:<名字>` / `--key-pass env:<名字>`（`sign --help` 已列出该格式），所以用环境变量传口令，而不是像 bat 那样写 `pass:<明文>` —— 后者在任务管理器与进程列表里都能看到。keytool 那边同理用 `-storepass:env`。

## 阶段 6：导入导出

- [x] `channels:import`：读 JSON → **原样复制** `channelInfoList`（渠道名与别名逐字保留，不做前缀替换）。
- [x] `channels:export`：写 JSON，结构与 `channelConfig.sample.json` 完全一致。
- [x] 导入时校验 JSON 结构；结构不符给出明确错误而不是静默吞掉。
- [x] 文件选择对话框放在主进程（`dialog.showSaveDialog` / `showOpenDialog`），渲染层只发「要做什么」，不接触任意路径。

**验证**

```powershell
# 导入 → 导出 → 与原文件逐字段比对
node -e "
const a=require('./channelConfig.sample.json');
const b=require('./data/channels/demo.json');
console.log('条数', a.channelInfoList.length, b.channelInfoList.length);
console.log('一致', JSON.stringify(a.channelInfoList)===JSON.stringify(b.channelInfoList));
"
```

### 配置包（R25）

- [x] `src/main/configpack.ts`：导出 zip，含 `manifest.json`（版本 / 导出时间 / 各文件 SHA256）、`jks.json`、`keystores/`、`channels/`、`template.json`。
- [x] 导入时逐文件校验 SHA256，不匹配即中止并指明是哪个文件。
- [x] 冲突处理：同 `id` 且 SHA256 相同 → 跳过；同 `id` 但内容不同 → 让用户选「跳过 / 保留两份（自动加后缀）/ 覆盖」，**不静默覆盖**。
- [x] 导入按钮旁直接写明「配置包含明文密码与私钥」，不能只写在文档里。
- [x] 导出**不含** `logs/` 与 `.runtime/`。
- [x] 界面先做只读预览（校验 + 冲突探测），用户选完策略再真正落盘 —— 设计只写了 `pack:import` 一个通道，但「让用户选」必然需要一个不改数据的探测步骤，故拆成 `pack:import`（选包 + 校验 + 探测）与 `pack:importApply`（按策略落盘）。

**验证**：导出 → 在另一个干净目录导入 → jks、渠道、模板全部还原，并可直接出包。

> **不用新增依赖**：zip 读写直接用内置 JRE 里的 `jar.exe`（`jdk.jartool` 已被 jlink 保留，与 java/keytool 同一个 JRE）。此前考虑过 `adm-zip`，实测 `jar` 够用且更省依赖：
>
> | 用途 | 命令 |
> |---|---|
> | 打包 | `jar --create --no-manifest --file=<包> -C <暂存目录> .` |
> | 解包 | `jar --extract --file=<包>`，工作目录用 `spawn` 的 `cwd`（`-C` 只对 create 有效） |
>
> 中文文件名按 UTF-8 存入 zip 且能正确还原。**路径穿越也已验证**：手工造了一个含 `../evil.txt` 条目的 zip，`jar --extract` 没有写到目标目录之外；`configpack.ts` 另外用 `safeJoin` 再挡一层（manifest 里的路径由包作者提供，不能直接信）。
>
> **阶段 6 实测结果**（用真实主进程模块跑，不走原生对话框；临时测试入口用 `rolldown` 打包后在 Electron 里执行，未进仓库）：
>
> | 场景 | 结果 |
> |---|---|
> | 导出配置包 | 6 个文件 / 6247 字节；条目为 `manifest.json`、`jks.json`、`template.json`、`keystores/{a,b}.jks`、`channels/{a,b}.json` |
> | 导出排除项 | **不含** `logs/`、`.runtime/`，也不含 `META-INF/`（用了 `--no-manifest`） |
> | 清空 data 后导入 | 2 个 jks 全还原；别名 / 口令 / app / `keystoreFile` 逐字段一致；渠道列表逐字段一致；模板还原 |
> | 导入后可否直接出包 | 内置 keytool 校验副本 `ok:true`（`alias=akey`）；错误口令仍返回「口令不正确」，不会误判 |
> | `channels:export` | 条数、`defaultExtraInfo.app`、`channelInfoList` 与存储逐字段一致 |
> | `channels:import` | 渠道名与别名**原样保留**（`RAW_one`/`原样甲`，未被加前缀）；文件里的 `app` 与本 jks 不同时给出说明且不采用 |
> | 结构校验 | 6 种坏输入各自命中预期错误：非 JSON / 顶层是数组 / 缺 `channelInfoList` / `channel` 为空 / `alias` 非字符串 / 条目非对象 |
> | 冲突：同 id 同 SHA256 | 跳过 2 个，不写入 |
> | 冲突：同 id 不同内容 | 探测到 1 个冲突；`skip` → 跳过 2、条目数不变；`keep-both` → 另存 `a_2`（原 `a` 保留，共 3 条）；`overwrite` → 就地覆盖 1 个，副本内容回到包内那份 |
> | SHA256 不符 | 中止并指明文件：「文件校验失败：keystores/a.jks（SHA256 与 manifest 不符…）」 |
> | 非本工具的 zip | 拒绝：「这不是本工具导出的配置包：缺少 manifest.json」 |
> | 界面 | 模板页有「配置包」卡片与导出/导入按钮，**明文密码与私钥的提示直接写在页面上**；渠道页在选中 jks 后出现「导入 JSON」「导出 JSON」 |
>
> **实测抓到的真 bug**：导入冲突策略 `keep-both` 时，新条目用了新 id（`a_2`）却仍按原 id 去 `findIndex` 定位替换，结果把原条目 `a` 顶掉 —— 导入后 `items` 只剩 `a_2,b`，`a` 消失。已改为只有 `overwrite` 才就地替换，`keep-both` 一律追加。这个问题不测就看不出来：`a_2` 的副本与渠道文件都正常落盘，只有原条目不见了。

## 阶段 7：打包与便携性验证

- [x] 配 `electron-builder.yml`，`target: portable`，`extraResources` 带 `bin/`。
- [x] `src/main/paths.ts` 用 `PORTABLE_EXECUTABLE_DIR` 解析 `data/`，并同步 `app.setPath('userData', …)`。
- [x] 构建，记录最终 exe 体积（预期 ≈ 185 MB，验收线 190 MB 以内）。
- [x] **便携性验证**：把 exe 拷到一个全新目录运行 → 新增一个 jks、改模板 → **关掉应用重开，确认配置仍在**。这是 portable 目标最容易失败的验证点 —— exe 每次启动都自解压到 `%TEMP%`。
- [x] **环境隔离验证**：临时清空 `JAVA_HOME` 与 `PATH` 中的 java 项，运行 exe，确认重签名仍可用。
- [x] **分发验证**：把**仅 exe** 拷到另一目录运行 → 应是干净工具（无 jks、无渠道）；再导入配置包 → 数据完整还原。

### 实际产物体积

| 项 | 体积 |
|---|---|
| 最终 exe | **113.9 MB**（验收线 190 MB 以内） |
| `win-unpacked/resources/bin` | 33.4 MB（内置运行时，124 个文件） |
| `win-unpacked/resources/app.asar` | **0.54 MB** |

设计里的「≈185 MB」是按未压缩体积估的（Electron ≈150 MB + 运行时 33.4 MB）；portable 目标用 NSIS 固实压缩，实际落盘 113.9 MB。

> **`app.asar` 从 80.8 MB 降到 0.54 MB**：`package.json` 里原本 9 个包全在 `dependencies`，electron-builder 会把生产依赖整棵子树打进 asar。但主进程与 preload 只 import `electron` 和 Node 内置（已用 grep 核对），那 9 个包只被渲染层用、且已被 Vite 打进 `dist/`。全部改归 `devDependencies` 后，asar 只剩 `dist/` + `dist-electron/` + `package.json`。这不只是体积问题 —— 分发的产物里不该带运行时根本不会加载的第三方代码与许可证。

> **本机 `pnpm dist` 不可用的原因**（与工程无关）：这台机器上的 pnpm 跑在 DSH Desktop 的 Electron-as-Node 里，pnpm 会把脚本体内的 `node` 替换成宿主二进制，于是 `.bin/electron-builder.CMD` 内部的 `node cli.js` 变成了 `DSH Desktop.exe cli.js --win portable`，报 `Unknown argument: …cli.js`。直接调 `.\node_modules\.bin\electron-builder.CMD --win portable` 正常（cmd.exe 内 `node` 从 PATH 取到真 node）。换台正常机器 `pnpm dist` 即可用。

### 阶段 7 实测结果

| 验证项 | 做法 | 结果 |
|---|---|---|
| 便携性 | exe 拷到全新目录 `install1`，走界面新增 jks（`port`）+ 模板加一行 | `data/` 建在 **exe 旁边**，不在 `%TEMP%`；含 `jks.json`(508 B)、`keystores/port.jks`、`channels/port.json`、`template.json`(901 B)、`logs/`、`.runtime/`（Chromium 缓存） |
| 关掉重开 | 杀掉进程再启动 | jks 行仍在（`port.jks 推导 port portkey port`）；模板 14 行，最后一行 `portable_probe / 便携探针` 读输入框确认仍在 |
| 环境隔离 | `JAVA_HOME` 置空 + PATH 里剔除 `java\|jdk\|jbr\|Android`，确认 `Get-Command java`/`keytool` 都找不到 | 打包版仍能新增 jks（内置 keytool 校验通过） |
| 打包版全流程出包 | 同上隔离环境，真实 99.5 MB APK，只勾 `iso_yyb` | 产出 1 个 `示例应用_V1.4.6_20260916_1727_应用宝.apk`，界面校验「通过」，告警 `[]`，页面错误 `[]` |
| 独立核对产物 | 内置 walle / apksigner | `walle show -c` → `iso_yyb`；`walle show -e` → `{app=iso}`；`apksigner verify` → `Verifies`（v1/v2/v3 均 true） |
| 中间产物清理 | 检查输出目录与输入目录 | `.work` 已清空；输入目录留下 `_resigned.apk`（设计如此） |
| 日志 | 读 `data/logs/<taskId>.log` | 250 KB，UTF-8，中文正常 |
| 干净工具 | 只拷 exe 到 `install3` | 无 jks、无渠道，空态文案正确，页面错误 `[]` |
| 图标 | electron-builder 输出 | `default Electron icon is used` —— **未配应用图标**，分发时仍是 Electron 默认图标 |

> **当时未能自动化的那一项**：打包版里「点导出配置包 / 导入配置包 → 原生对话框 → 确认」这条链路当时没跑通，原因是本机**桌面会话处于锁屏状态**（按键注入只能送到锁屏界面），且这个原生对话框把控件暴露成**没有任何 UIA Pattern 的 Pane**（文件名框 `class=Edit`、`AutoId=1001`，`GetSupportedPatterns()` 为空；保存按钮 `class=Button`，无 `InvokePattern`），`WM_SETTEXT` 写进去也不生效。当时只确认到「点击 → `#32770` 对话框以正确标题弹出」这一步。**该缺口已在解锁的机器上补跑通过，见下节。**

### 分发验证实测（解锁桌面后补跑）

两个安装目录各只放 exe：`install2` 走界面新增 1 个 jks（`dist` / 口令 `dist@123` / 别名 `distkey`）并按模板生成 13 条渠道；`install3` 保持干净。

| 环节 | 做法 | 结果 |
|---|---|---|
| 导出 | 打包版点「导出配置包」→ 原生保存对话框 → 确认 | `Documents\渠道配置包_2026-09-30.zip`，4001 字节；界面提示 `已导出配置包：…（4 个文件，4 KB）` |
| 干净工具 | 启动 install3 | `checkRuntime().ok = true`；jks 数 0；`data/` 只有 `template.json` 与空目录 |
| 导入 | 点「导入配置包」→ 原生打开对话框选中包 → 预览 → 确认导入 | 预览显示「包内 1 个 jks、1 份渠道文件」「校验已通过」「没有冲突：包内条目要么本机没有，要么与本机完全相同」 |
| 还原比对 | 与 install2 逐文件 SHA256 比对 | `jks.json` `BF97FF70F8CFCD3D`、`template.json` `73FF88B4E8C094AD`、`channels/dist.json` `289E6D3FB3FE32BD`、`keystores/dist.jks` `14C22E2F889705FD` —— 四项全一致 |
| 独立校验 | 用还原出来的 jks 校验凭据 | `{ok:true, alias:'distkey', aliases:['distkey']}` |
| 渠道还原 | 读回渠道列表 | 13 条，首条 `dist_jl_flow/巨量`，末条 `dist_uc/UC` |

驱动原生对话框的两个关键点（都是踩过坑才定下来的）：

| 问题 | 现象 | 可行做法 |
|---|---|---|
| 确认按钮点不动 | `WM_COMMAND(IDOK)` 被 DirectUI 忽略；对「保存(&S)」按钮发 `BM_CLICK` 无效；真实鼠标点击会以 `canceled` 收场 | 向对话框 `PostMessage(WM_KEYDOWN/WM_KEYUP, VK_RETURN)`。保存对话框有默认文件名，回车即可确认 |
| 输入法吞字符 | 中文输入法的标点模式把 `\`→`、`、`:`→`：`；字母串被吞进组字缓冲，回车被当成上屏；`KEYEVENTF_UNICODE` 注入、`ActivateKeyboardLayout(en-US)`、`WM_INPUTLANGCHANGEREQUEST` 都拦不住（TSF 输入法） | **完全不打字**：剪贴板放完整路径，在文件名框按 `Ctrl+V`。粘贴不经过输入法，`\` 与 `:` 原样进入，随后回车打开 |

> 顺带排掉一个假警报：过程中出现过 `spawn …\Temp\<解压目录>\resources\bin\jre\bin\jar.exe ENOENT`，且 `checkRuntime().ok = false`、六个运行时组件全缺。根因是我的清理脚本**先删 `%TEMP%` 解压目录、后杀进程** —— 正在运行的文件删不掉，留下残缺目录，而 portable stub 下次启动会复用同名目录。按「先杀进程（要连解压目录里的子进程一起杀，只杀 stub 不够）再删目录」的顺序重跑，`checkRuntime().ok = true`，六个组件齐全。**便携版本身没有问题**：`7za l` 能列出 exe 内的 `resources\bin`，解压后 124 个文件也在。

---

## 收尾项（阶段 7 之后）

| 项 | 状态 | 处理 |
|---|---|---|
| 应用图标 | 已解决 | 新增 `app/scripts/make-icon.ps1` 生成 `app/build/icon.ico`（16/24/32/48/64/128/256 七档 PNG 容器），`electron-builder.yml` 里 `win.icon` 指向它。重新打包后日志中 `default Electron icon is used` 消失，从 exe 里 `ExtractAssociatedIcon` 取出的 48×48 图标即新图形。exe 体积不变（113.9 MB） |
| `package.json` 缺 `author` | 已解决 | 补 `author: dhhheee` 与 `license: MIT`，electron-builder 的 `author is missed` 警告消失 |
| README | 已解决 | 新增根目录 `README.md`：功能对比、使用步骤、数据目录结构、配置包分发语义与明文口令警告、从源码构建（含 `prepare:runtime` 的产物来源表）、已知注意事项、第三方组件归属 |
| LICENSE | 已解决 | 新增根目录 `LICENSE`（MIT，Copyright (c) 2026 dhhheee） |
| `pnpm dist` 在本机不可用 | 已记录 | 写进 README 的「已知注意事项」。根因是 pnpm 把脚本体里的 `node` 替换成它自身运行所在的 Node，而本机 pnpm 跑在 DSH Desktop 的 Electron-as-Node 里，于是 `.bin/electron-builder.CMD` 内部的 `node cli.js` 变成 `DSH Desktop.exe cli.js`。绕开方式是直接调 `.CMD`。**不在仓库里加 workaround 代码** —— 普通 Node 环境下 `pnpm dist` 本来就正常，为单一环境加脚本反而给开源用户增加噪音 |
| 分发链路自动化 | 已解决 | 桌面解锁后补跑通过：install2 导出配置包（4 文件 / 4001 字节）→ install3（仅 exe，干净）导入 → 四个文件 SHA256 与 install2 全一致，`verifyCredentials` 通过，13 条渠道还原。驱动原生对话框的可行做法见「分发验证实测」一节 |

### 顺带修正的两份过期 spec

本会话实际踩到、且与既有 spec 文档冲突的两处，已改正：

| 文档 | 原文（错） | 改后 |
|---|---|---|
| `.trellis/spec/shared/pnpm-electron-setup.md` | 教人把 `node-linker` / `shamefully-hoist` 写进 `.npmrc` | 改为写进 `pnpm-workspace.yaml`（camelCase），并注明 pnpm 10+ 会**静默忽略** `.npmrc` 里的这些键 |
| `.trellis/spec/frontend/electron-browser-api-restrictions.md` | 说 `File.path` 不可用是 context isolation 导致，并建议「在主进程处理拖拽」 | 改为 Electron 32 移除了 `File.path`，正确做法是 preload 里 `webUtils.getPathForFile(file)` 经 contextBridge 暴露；并补充「主进程根本感知不到拖拽」与 `sandbox: false` 两个坑 |

pnpm 那条是实测确认的（pnpm 11.8.0）：

| 写法 | 结果 |
|---|---|
| 只在 `.npmrc` 写 `node-linker=hoisted` | 被忽略。`node_modules` 仍是 `.pnpm` + 符号链接，传递依赖 `clsx` 没提升到顶层 |
| 在 `pnpm-workspace.yaml` 写 `nodeLinker: hoisted` | 生效。`clsx`、`react` 直接落在顶层，且是真实目录而非符号链接 |

## 后续增强：可用性四项（2026-10-08）

阶段 7 收尾后按使用反馈补的四项。两处口径先问过用户：

| 问题 | 选择 | 含义 |
|---|---|---|
| 「导出模板 JSON」导的是什么 | A | 导 `data/template.json` 的**后缀表本体**，改完导入后**只展开成当前 jks 的渠道列表**，不回写模板页的模板 |
| 多选删除加到哪几页 | B | 「渠道配置」与「渠道模板」两页都加 |

| # | 需求 | 实现 |
|---|---|---|
| 1 | 新增 jks 时口令可看明文 | 口令框右侧加眼睛按钮，切换 `type` 在 `password`/`text` 之间。`aria-label` 随之在「查看口令明文」「隐藏口令」间切换，便于读屏与自动化定位 |
| 2 | 新增 jks 时渠道数据无论选哪项都有预览列表，且能同时新增渠道 | 对话框内引入 `draftChannels: PairRow[]` 作为**唯一真相**：三个来源（不套用模板 / 套用模板 / 导入 JSON）都只负责「怎么填这份列表」，`PairListEditor` 始终渲染在下方可增删改。保存时直接落这份草稿，不再按来源分支 |
| 3 | 渠道列表可多选删除 | `PairListEditor` 新增 `selectable`：表头全选框（支持 `indeterminate`）+ 每行复选框 + 「已选 N 项 / 删除选中 / 取消选择」工具条。`picked` 用 `useMemo` 按当前 `rows` 过滤失效 rowId，不用 effect 清 |
| 4 | 可导出默认模板 JSON，改完再导入 | 主进程新增 `template:export` / `template:import` 两个通道：前者原样写 `readTemplate()` 并回 `isDefault`（是否仍是内置种子），后者严格解析 `suffixes` 后经 `buildChannelsFromTemplate` 展开写入当前 jks |

### 实测结果（开发构建 + CDP 驱动，页面错误 `[]`）

| 验证项 | 结果 |
|---|---|
| 口令明文按钮 | 点一下 `type=text` / `aria-label=隐藏口令`，再点回 `password` |
| 预览列表：不套用模板 | 空列表 + 提示「还没有渠道条目…」，点两次「添加一行」得 2 行 |
| 预览列表：套用模板 | 4 条后缀 → 4 行 `gf/官方`…`bd/百度`；前缀改 `gamma` 后整列变为 `gamma_gf`… |
| 预览列表：导入 JSON | 切换时清空（避免残留旧内容），提示「尚未选择文件」 |
| 校验 | 空渠道名 → 「渠道名不能为空，请补全或删掉空行。」；两条同名 → 「渠道名重复：gamma_gf」 |
| 新增 jks 同时建渠道 | 填 `gamma.jks`/`gammakey`/`g@1234`，套模板 + 前缀 `gamma`，提交后提示「已新增 gamma 并校验通过。」，`data/channels/gamma.json` 落 4 条 `gamma_gf…gamma_bd` |
| 多选删除（渠道配置） | 4 行中勾选 `gamma_gf`、`gamma_uc` → 工具条「已选 2 项」→ 删除后剩 2 行且归零为「共 2 项」，保存后文件同步为 2 条 |
| 多选删除（渠道模板） | 4 条中勾选 `yyb`、`uc` → 删除后剩 `gf`、`bd` |
| 导出模板 JSON | 原生保存对话框回车确认 → 写出 `{version:1, suffixes:[…4 条…]}`，提示「已导出模板 4 条后缀」 |
| 导入模板 JSON | 手改成 `hw/华为、xm/小米、oppo/OPPO` 后导入 → 渠道列表变为 `gamma_hw`、`gamma_xm`、`gamma_oppo`，落盘一致 |
| 拿错文件 | 导入 `channelInfoList` 结构 → 「选择的文件是渠道列表而不是模板，请用「导入 JSON」。」，列表不动 |

驱动原生「打开」对话框这次换了更稳的做法（比上次的剪贴板 + `SendKeys` 可靠）：给**最靠下的那个 `Edit`**（文件名框）直接发 `WM_PASTE(0x0302)`，再给对话框发 `WM_KEYDOWN/WM_KEYUP VK_RETURN`。`SendKeys` 会因为对话框被摆到负坐标的副屏而不生效。

## 后续增强：可用性两项（2026-10-08 续）

接使用反馈补的两项。

| # | 反馈 | 根因 | 实现 |
|---|---|---|---|
| 1 | 新增 jks 弹窗拖入 jks 文件不生效 | 输入框 placeholder 写着「拖入或点击右侧按钮选择 .jks 文件」，但 `JksFormDialog` **完全没有 `drop` 处理** —— 界面在承诺一个不存在的功能 | 对话框 body 挂 `onDragEnter/onDragOver/onDragLeave/onDrop`；`dragDepth` 计数避免子元素间高亮闪烁；`dragover` 必须 `preventDefault()`，否则 `drop` 事件根本不来。投放区改成常驻虚线框（拖拽中 `border-primary bg-primary/5`），避免布局跳动。拖进来的文件不受 `accept` 过滤，所以自己判扩展名：`.json` 给「这是 JSON 渠道文件，不是 jks」的针对性提示。编辑模式不接收拖入 |
| 2 | 渠道配置中导入 JSON 需要先弹窗预览确认导入 | 主进程 `importChannels` 选完文件**直接 `writeChannels` 落盘**，没有任何确认；渠道列表是整表替换，选错文件代价大 | 仿照既有「配置包导入」的两步式拆通道：`channels:import` / `template:import` 改为**只读**预览（返回 `ChannelListPreview`），新增 `channels:importApply` / `template:importApply` 才落盘。渲染层新增 `ChannelListPreviewDialog`，列出将写入的渠道、条数变化、清空与未保存修改的警告 |

**「导入模板 JSON」一并加确认框**：用户只提了「导入 JSON」，但它是相邻的同类按钮、同样静默覆盖，所以按同一套处理。

**apply 时重新读一次文件**，不信任渲染层回传的内容 —— 以「点确认那一刻磁盘上的内容」为准，避免预览与落盘之间文件被改。

| 验证项 | 结果 |
|---|---|
| 拖拽高亮 | 投放区 `border-dashed border-border` → dragEnter 后 `border-primary bg-primary/5` → drop 后复原 |
| 拖拽落值 | `#jks-source` 填上路径、`#jks-alias`/`#jks-app` 由文件名推导、口令自动带出 |
| 拖错文件 | 拖 `.json` → 「这是 JSON 渠道文件，不是 jks；请用下面「渠道数据」里的「选择文件」。」 |
| 导入渠道 JSON | 确认框「从「channels-in.json」读到 3 条渠道…当前 2 条 → 导入后 3 条」+ 明细表；**确认前磁盘仍是 `alpha_gf, alpha_yyb`**；取消 → 界面与磁盘都不变；确认 → 磁盘变 `imported_one, imported_two, imported_three` |
| 导入模板 JSON | 「当前 3 条 → 导入后 2 条」+ `alpha_hw/华为`、`alpha_xm/小米`（前缀已展开）；确认前不落盘，确认后落盘 |
| 未保存修改 | 确认框出现「当前列表有未保存的修改，导入会丢弃它们…」 |
| 空列表 | 「文件里一条渠道都没有，确认导入会把当前 3 条全部清空。」 |
| 坏 JSON | **不弹确认框**（`[data-slot=dialog-content]` 计数为 0），状态栏报「选择的文件不是合法的 JSON」，磁盘不变 |
| 打包版回归 | 便携版 exe 上重跑拖拽与导入确认，结果与开发构建一致，页面错误 `[]` |

## 后续增强：界面修正六项（2026-10-08 再续）

接使用反馈修的六项。第 1 项是缺陷，其余五项是交互收紧与能力替换。

| # | 反馈 | 根因 / 口径 | 实现 |
|---|---|---|---|
| 1 | 点「查看渠道」把文件路径当成渠道号显示 | walle 对**没写过渠道**的包退出码仍是 `0`，只输出一行 `<绝对路径> : `（冒号后为空）。`.trim()` 后变成 `<路径> :`，**不含 `' : '`**（冒号后没有空格），`lastIndexOf` 返回 -1，而旧代码的兜底分支是「没分隔符就返回整行」——于是路径被当成了渠道号 | `valueAfterPath` 改按 `' :'` 切；**没有分隔符一律返回空串**，不再退回整行。结果从页面底部状态行改成弹窗：`ok` 且渠道号为空、额外信息也空时只说「这个包里没有渠道信息，说明它还没被写过渠道。」，任何分支都不显示文件路径。`ipc/task.ts` 里额外信息的空串统一成 `undefined`，避免「读到但是空」和「没读到」混在一起 |
| 2 | 新增 jks 弹窗没选 jks 时不应能操作渠道数据 | 渠道名要靠 jks 的文件名/前缀推导，没选文件时那一片控件全是无效操作 | `JksFormDialog` 用 `noJks = sourcePath.trim() === ''`：`渠道数据来源` Select 与 `PairListEditor` 都传 `disabled`，标题右侧提示改成「先在上面选择 jks 文件」。`PairListEditor` 新增 `disabled`，透传到行内输入框、复选框、「添加一行」「删除选中」 |
| 3 | 新增 jks 弹窗的渠道数据要多选删除 | 对话框里的草稿列表只支持逐行删，批量造数据时很啰嗦 | 给对话框里的 `PairListEditor` 加 `selectable`（组件本身上一轮已支持） |
| 4 | 没有渠道列表时不允许导出 JSON | 导出空列表没有意义 | 「导出 JSON」`disabled={rows.length === 0 \|\| saving}` |
| 5 | 导入 JSON 时可选是否覆盖，否则追加，默认覆盖 | 原实现只有整表替换，想把两批渠道合起来得先手工拼文件 | 确认框加「覆盖 / 追加」一对按钮（项目里没有 radio-group 组件，用 `aria-pressed` 的 Button 表达选中态），默认覆盖。主进程 `applyChannels(id, app, sourcePath, mode)` 的 `append` 分支读现有列表后合并，**按 `channel.trim().toLowerCase()` 去重**（同名条目在 walle 里会互相覆盖，不能放进去），回 `added` / `skipped`。追加时条数先给上界（`最多 currentCount + count`），精确值由主进程算 |
| 6 | 去掉模板 JSON 的导出导入，改成没有渠道列表时导出示例 | 上一轮的「模板 JSON」导的是 `data/template.json` 的后缀表本体，与「按模板生成」职责重叠，多一条链路多一处出错 | 删掉 `template:export` / `template:import` / `template:importApply` 三个通道及对应主进程函数，新增 `channels:exportSample`。「导出示例 JSON」**只在渠道列表为空时可用**，条目走 `buildChannelsFromTemplate`（与「按模板生成」共用，避免两处算出不同的渠道名），模板为空时退回内置两条兜底（`gf/官方`、`yyb/应用宝`）。导出文件顶层多一个 `_说明` 字段：`parseChannelConfig` 只读 `channelInfoList` 与 `defaultExtraInfo`，多余字段会被忽略，所以它纯粹是写给用户看的注释 |

口径说明：需求 6 只说了「没有渠道列表时导出示例 json」，没说清示例条目从哪来。这里取「渠道模板页的模板 + 当前前缀」，模板为空才退回内置两条 —— 理由是与「按模板生成」同源，用户改完模板后示例会跟着变，不用维护第二份清单。

### 实测结果（开发构建 + CDP 驱动，页面错误 `[]`）

| 验证项 | 结果 |
|---|---|
| 查看渠道：未写渠道的包 | 弹窗「这个包里没有渠道信息，说明它还没被写过渠道。」；界面与弹窗里都没有文件路径（旧版状态行显示的正是 `…<应用名>_V1.4.6_20260924_1822.apk :`） |
| 查看渠道：已写渠道的包 | 某个已写过渠道的官方包 → 渠道号 `<前缀>_gf`、额外信息 `{app=<前缀>}`，与 walle 命令行输出一致 |
| 新增 jks：没选文件 | `渠道数据来源` 的 `disabled` 为 `true`、「添加一行」`disabled` 为 `true`、行内只剩表头全选框（同样禁用）；提示变「先在上面选择 jks 文件」 |
| 新增 jks：选好文件后 | Select 与「添加一行」恢复可用，行内出现逐行复选框 |
| 新增 jks：多选删除 | 造 3 行 `v3_x/v3_y/v3_z` → 勾前两行 → 工具条「已选 2 项」→ 删除后只剩 `v3_z` |
| 渠道列表为空 | 「导出 JSON」`disabled` 为 `true`、「导出示例 JSON」可用 |
| 渠道列表非空 | 反过来：「导出 JSON」可用、「导出示例 JSON」`disabled` 为 `true` |
| 导出示例 JSON | 原生保存框回车确认 → 写出 1123 字节 JSON，含 `_说明` 与 `channelInfoList`，条目与模板页一致 |
| 导入确认框默认态 | 描述「从「inc.json」读到 2 条渠道。确认后会整表替换当前列表。」、`覆盖` 的 `aria-pressed` 为 `true`、主按钮「覆盖导入」 |
| 切成追加 | 描述变「确认后与当前列表合并，同名渠道不重复。」、旁注变「保留现有条目，只补文件里多出来的」、主按钮「追加导入」 |
| 追加结果 | 现有 `t1_gf`/`t1_yyb` + 文件里的 `T1_YYB`/`t1_hw` → 落盘 3 条，`T1_YYB` 被跳过（去重忽略大小写），状态「已追加 1 条（跳过重名 1 条），现共 3 条并保存。」 |
| 追加时 app 不一致 | 状态栏追加一句「文件里的 defaultExtraInfo.app 是「别的应用」，与本 jks 的「测试应用」不同；按 jks 的值为准，文件里的未采用。」，落盘仍是「测试应用」 |
| 打包版冒烟 | 便携版 exe 启动后四个页面都能进：`查看渠道` 按钮在、未选 jks 时 `渠道数据来源` 禁用、模板 JSON 两个按钮已消失、`导出示例 JSON` 存在且因列表非空而禁用，页面错误 `[]` |

## 后续增强：出包产物整理与跳过签名校验（2026-10-08 三续）

起因是问「一次出包到底往磁盘上扔了哪些东西」。核下来是：原包、重签名时另存的 `_resigned.apk`（99.5 MB）、`渠道包\<原包名>_<别名>.apk`、失败时的 `渠道包\.work\<taskId>\`。用户对四个问题逐一拍板：

| 问题 | 决定 |
|---|---|
| `_resigned.apk` 还要不要 | 要，而且**要能当输入包用** —— 下次出包直接喂它就能跳过重签名 |
| 输出要不要按批次分目录 | 不要，保持平铺 |
| 失败残留的 `.work\` 怎么办 | 留着（排查要用），但**每次重新生成时自动清掉** |
| 跳过签名时要不要校验这个包是不是当前 jks 签的 | 做；配套的 `manifest.json` 不做 |

### 改动

| 位置 | 改动 | 理由 |
|---|---|---|
| `app/src/main/pipeline.ts` | 另存的文件改名 `<原包名>_已签名_未写渠道.apk`，并补上一直没发出的 `resigned-copy` 阶段 | 原名里的 `_resigned` 与正式产物太像，容易被误当成品发出去 |
| `app/src/main/pipeline.ts` | 新增 `SIGNED_STEM_SUFFIX` 与 `stripSignedStemSuffix()`，`prepare()` 里 `apkBase` 先剥掉这段标记 | 那份包本身是合法输入，再次出包时产物名会一段段往上叠（`..._已签名_未写渠道_官方.apk`） |
| `app/src/main/pipeline.ts` | 跳过签名时，若输入包名带标记，先复制成干净名字再交给 walle | walle 按**输入包名 + 别名**命名产物，只剥 `apkBase` 不够 —— 这是实测才发现的一处 |
| `app/src/main/pipeline.ts` | `prepare` 阶段先 `rmSync(outputDir/.work)` 再建本次 workDir | 上一轮的中间产物对下一次没用，留着只会越堆越多 |
| `app/src/main/signer.ts` | 新增 `probeApkCertificate` / `probeKeystoreCertificate` / `assertSignedByKeystore` | 跳过签名 = 输出包的签名完全由输入包决定，喂错包要到安装或覆盖更新时才暴露 |
| `app/src/shared/types/task.ts`、`PackScreen.tsx` | `TaskStage` 加 `check-source`，`STAGE_LABELS` 补「核对输入包签名」、`resigned-copy` 改「另存已签名未写渠道的包」 | 否则失败卡片会把签名核对失败说成「卡在 apksigner 重签名」 |

取证书指纹的手法（都已实测）：

- APK 侧：`apksigner verify --print-certs <apk>`，从输出里按行匹配 `certificate SHA-256 digest:`。它会在几十上百行 `META-INF/... not protected by signature` 警告里夹这几行证书信息，所以不能整段解析。
- jks 侧：`keytool -exportcert -alias <alias> -keystore <ks> -storepass:env <ENV> -rfc`，PEM 里的 base64 解回 DER 再算 SHA-256。**语法是 `-storepass:env NAME`（空格分隔）**，写成 `-storepass:env:NAME` 会报「未知选项」；`-J-Dfile.encoding=UTF-8` 这类 `-J` 参数可以正常转给 JVM，不加的话中文提示是 GBK 乱码。
- 两侧算出来的值同一个，所以直接比字符串。

### 实测结果（开发构建 + CDP 驱动，页面错误 `[]`）

| 场景 | 结果 |
|---|---|
| 重签名一次 | `出包完成 2 个包`，产物 `示例应用_V1.4.6_20260916_1727_官方.apk` / `_华为.apk`；原包旁出现 `示例应用_V1.4.6_20260916_1727_已签名_未写渠道.apk`（99.46 MB） |
| 跳过签名 + 这份包 | 核对通过；产物名仍是 `<原包名>_官方.apk`（标记已剥掉）；日志里两侧指纹都是 `f39fd21e7a3bec9c2841a097394937d130520bbb7459a85ee4873b7554bd3683`，并有一行「输入包名带「已签名未写渠道」标记，已复制为：…」 |
| 跳过签名 + 别的 jks 签的包 | `出包失败` / `卡在：核对输入包签名` / **没有退出码行** / 文案「这个包不是用 jks「t11」签的（包里证书 53c1f20f264a5218…，jks 里证书 f39fd21e7a3bec9c…）…」，显示「这一步没有子进程输出 —— 报错来自程序自己的检查，不用去日志里找。」 |
| 跳过签名 + 损坏的 .apk | 文案「这个包读不出签名证书（没签名或文件损坏），跳过签名会得到装不上的包，已中止」，并附 `--print-certs` 输出的末尾 10 行（`Malformed APK: not a ZIP archive`） |
| `.work` 自动清理 | 一次失败留下 `.work\20261008-182202-gxgn`；下一次出包后该目录消失，只剩本次的 `.work\20261008-182257-l9wn` |

## 后续增强：子进程超时与日志轮转（2026-10-08 四续）

起因是审计里的专项 D 两个口子：

- **子进程卡住时任务永不结束。** walle / apksigner / zipalign 都是 `spawn` 出来 `await` 的，它们既不退出也不打印时，`await` 永远不回来 —— 界面一直转，用户只能强杀应用。
- **`data/logs/` 无限涨。** 每个任务一份完整日志，一个 100 MB 的包光 zipalign 就刷几千行，用久了没人会去手动清理。

### 改动

| 位置 | 改动 | 理由 |
|---|---|---|
| `app/src/main/proc.ts` | 新增 `CHILD_IDLE_TIMEOUT_MS = 10 * 60 * 1000`（**空闲**超时，不是总时长），`RunOptions` 加 `idleTimeoutMs`（传 0 关闭） | 大包在慢磁盘上跑十几分钟是正常的，但**十几分钟一个字都不输出**不正常。按「多久没动静」判定，才不会误杀 |
| `app/src/main/proc.ts` | 每读到一块输出就重置计时器；到点 `SIGKILL` 掉进程，等 `close` 事件统一收尾 | 卡住的进程不会自己退，必须先杀；等 `close` 是为了把已经收到的输出一起带出来 |
| `app/src/main/proc.ts` | 杀完 5 秒还没 `close` 就直接 reject，不再等 | 万一进程卡在内核里，任务仍然会结束，不会永远转 |
| `app/src/main/proc.ts` | `StepFailure` 加 `timedOut` 字段（第 4 个参数，默认 `false`） | 「被超时杀掉」与「跑完了但退出码非 0」要分开说，否则界面只能显示成后者 |
| `app/src/shared/types/task.ts`、`app/src/main/pipeline.ts` | `TaskFailure` 加 `timedOut?`，catch 里从 `StepFailure` 透传 | 与 `exitCode`/`outputTail` 同一套通路，界面不用额外请求 |
| `app/src/renderer/src/screens/PackScreen.tsx` | 卡片头部多一句「卡住后已强制结束」；没有输出时不再说「报错来自程序自己的检查」，改说「等到超时就被强制结束了 —— 日志里能看到它停在哪个动作上」；复制内容里也加一行 | 原来那句兜底文案对超时场景是错的，会把用户引到「去找我们的输入校验」上去 |
| `app/src/main/logger.ts` | 新增 `pruneTaskLogs(dir)`：按 mtime 从最旧的删，直到份数 ≤ 30 且总体积 ≤ 50 MB；`MIN_KEEP_LOGS = 10` 是保底，再大也不删到 10 份以下 | 两道闸都要有：份数闸挡住「每次一点点」，体积闸挡住「某几次特别大」 |
| `app/src/main/logger.ts` | `createTaskLogger()` 里先清理再写新文件 | 清理点放在建日志之前：本轮这份刚建、永远是最新的，不会被自己清掉 |

清理日志与超时判定都**吞掉自己的异常**（删不掉就留着、读不了目录就当没有旧日志）—— 它们是收尾动作，不能反过来把出包搞失败。

### 实测结果（开发构建 + CDP 驱动，页面错误 `[]`）

单元级（把 `proc.ts`、`logger.ts` 单独编译后用 node 跑，15 项断言全过）：

| 场景 | 结果 |
|---|---|
| 静默进程（`node -e "setTimeout(()=>{},60000)"`，`idleTimeoutMs: 800`） | 825 ms 就抛 `StepFailure`，`timedOut === true`，文案「子进程超过 1 秒没有任何输出，已强制结束」，无退出码 |
| 持续输出的进程 | 不超时，`code=0`，输出收全 |
| 先输出、后卡死 | 超时，且 `outputTail` 里带着已收到的「前半段」 |
| 40 份 1 KB 日志 | 删到 30 份，删掉的是最旧的 5 份里的 10 份（`dummy01`–`dummy10`），最新的仍在 |
| 12 份 6 MB 日志（72 MB > 50 MB 上限） | 删到 10 份停手（保底生效） |
| 目录不存在 | 返回 0，不抛错 |

端到端（把 `CHILD_IDLE_TIMEOUT_MS` **临时**改成 1000 ms 制造真实超时，验完改回 10 分钟）：

| 场景 | 结果 |
|---|---|
| 重签名时 apksigner 静默超过 1 秒 | 卡片 `出包失败` / 原因「子进程超过 1 秒没有任何输出，已强制结束」/ `卡在：apksigner 重签名` / **没有退出码行** / 「卡住后已强制结束」/ 兜底文案已换成超时那句；`window.__h.errs()` 为空 |
| 同一张卡片点「复制诊断信息」 | 内容含「该步骤没有输出后被杀掉：等满超时时间仍未结束，已强制终止进程」，三条路径都已变成 `%USERPROFILE%\…` |
| 改回 10 分钟后重跑同一包 | `出包完成 1 个包`，与改动前行为一致（回归无变化） |
| 预置 35 份假日志后跑一次出包 | 目录从 35 份变成 31 份 = 30 份（`dummy06`–`dummy35`）+ 本次新日志，`dummy01`–`dummy05` 已删 |

## 后续增强：结果卡片上的三个动作（2026-10-08 五续）

起因是审计里的 P1-7「出包结果可回到界面」：结果卡片只把信息摆出来，看完就断了 —— 想打开产物目录、想再看一眼日志、想拿同一份包换个渠道再跑一遍，都得自己回到资源管理器或重新拖一次包。

三处口径先跟用户确认过：**「重跑本次」只把参数填回表单，不直接开跑**（同一份包换个渠道、换个输出目录再跑是常见动作，直接开跑会让人来不及改）；打开目录走系统文件资源管理器；日志路径那一行也变成可点的按钮。

### 改动

| 位置 | 改动 | 理由 |
|---|---|---|
| `app/src/shared/constants/channels.ts` | 新增 `shellOpenPath: 'shell:openPath'` | 通道名只有这一处来源，主进程与 preload 都从这里取 |
| `app/src/main/ipc/shell.ts`（新增） | `registerShellIpc()`：空路径直接回「没有可打开的路径」，路径不存在回「路径不存在，可能已经被移走或删掉了」，其余交给 `shell.openPath` | 返回错误信息而不是抛异常 —— 这是 `shell.openPath` 自己的契约（成功时空串）。失败时的工作目录、日志都可能被手工挪走，先自己验一遍才不会弹出更难懂的系统报错 |
| `app/src/main/main.ts` | 在 `registerClipboardIpc()` 之后注册 `registerShellIpc()` | 与既有 IPC 注册顺序一致 |
| `app/src/preload/preload.ts`、`app/src/shared/types/api.ts` | `openPath(targetPath: string): Promise<string>` | 渲染层只判空串，不需要区分错误种类 |
| `app/src/renderer/src/screens/PackScreen.tsx` | 结果卡片顶部加一行动作：「打开输出目录」「重跑本次」+ 一句「「重跑本次」只把参数填回上面的表单，不会立刻开跑」 | 放在产物表格之前：这是看完结果后最可能做的下一步 |
| `app/src/renderer/src/screens/PackScreen.tsx` | 新增 `lastRun` state，`handleStart` 里把这次用的 `TaskInput` 存下来；「重跑本次」用 `pendingPickedRef` 把勾选交给读渠道列表那个 effect | `setJksId` 会触发重新读盘并把勾选重置成「全选」，所以换 jks 时勾选必须等读完再套用；没换 jks 时那个 effect 不跑，直接套用 |
| `app/src/renderer/src/screens/PackScreen.tsx` | 日志那一行改成 `<button>`（不是 `Button` 组件） | 日志路径要能折行，而 `whitespace-nowrap` 写在 `Button` 的基类里，再叠一个 `whitespace-normal` 谁赢取决于 Tailwind 的生成顺序，不保险 |
| `app/src/renderer/src/screens/PackScreen.tsx` | `handleOpenPath(target, what)` 统一处理两个按钮：空目标与打不开都写成中文状态行 | 路径不存在时不再静默失败 |

### 实测结果（开发构建 + CDP 驱动，页面错误 `[]`）

成功场景（夹具 `id=t15` / 渠道 `t15_gf`(官方)、`t15_hw`(华为)，输入包 104,301,040 字节）：

| 场景 | 结果 |
|---|---|
| 先取消勾选「华为」再出包 | `出包完成 1 个包`，耗时 5.3 s |
| 把输出目录改掉、再点「全选」 | 表单变成 `…\changed` + 两条都勾上 |
| 点「重跑本次」 | APK / 输出目录 / jks / 签名模式全部回到上次出包时的值，`t15_hw` 重新变成**未勾选**；状态行「已把上次出包的参数填回上面，确认后点「开始出包」。」；「开始出包」按钮仍是空闲态、结果卡片仍是同一个任务 —— **确认没有自动开跑** |
| 点「打开输出目录」 | 资源管理器新开一个窗口，地址正是 `…\p7\out` |
| 点日志路径 | 用记事本打开了那份 `2026…log`，卡片上没有出现错误提示 |
| `window.api.openPath('')` | 返回「没有可打开的路径」 |
| `window.api.openPath('…\definitely-missing\x.log')` | 返回「路径不存在，可能已经被移走或删掉了」（都不产生副作用） |

失败场景（把夹具里的 `storePassword` 故意写成 `654321`）：

| 场景 | 结果 |
|---|---|
| 重签名时 apksigner 失败 | 卡片同时渲染三块：动作行（`打开输出目录` / `重跑本次` / 提示语）、失败诊断块（`卡在：apksigner 重签名` / `退出码：2` / 任务号 / 13 行输出 / `复制诊断信息` / 工作目录）、`日志：` + 可点按钮；`window.__h.errs()` 为空 |
| 改掉输出目录后点「重跑本次」 | 输出目录回到 `…\p7\out`，卡片还在 |

## 后续增强：覆盖渠道列表前先确认（2026-10-08 六续）

起因：审计 P1 清单里的「P1-6 —— 「按模板生成」与「改前缀」加确认」。两处都会**整表替换**用户手里的列表，其中「新增 jks」那处的隐患更重：`#jks-prefix` 原本是**每敲一个字符就按新前缀重算一遍**，手工改过的行会被静默冲掉（旧代码的注释里自己也写着「手工改过的行会被覆盖」）。

### 三处口径（改前与用户确认）

| 问题 | 结论 |
|---|---|
| 「新增 jks」里的前缀怎么处理 | 改成**手动重新生成**：改前缀只记下来、列表不动；旁边加「按模板重新生成」按钮，点它时若手改过行才确认 |
| 两个页面要不要各写一套 | 不。统一成「只有生成动作会覆盖列表，覆盖前先确认」 |
| 用什么判「会被覆盖掉东西」 | 渠道配置页用 `rows.length > 0 && dirty`（磁盘上还有一份，没保存就替换界面内容不会丢数据，不必打扰）；jks 弹窗用 `handEdited` 标记 |

用 `handEdited` 布尔标记而不是深比较「草稿是否等于生成结果」：只在程序性写入时清掉、只在 `PairListEditor` 的 `onChange` 里置位，比逐行比对 key/alias 更稳，也不怕行序变化。

### 改动

| 文件 | 改动 |
|---|---|
| `app/src/renderer/src/components/ConfirmDialog.tsx` | **新增**。`{open, onOpenChange, title, description, warning?, confirmText, cancelText, destructive?, onConfirm}`；只用来拦「点下去会覆盖掉用户手里东西」的动作 |
| `app/src/renderer/src/components/JksFormDialog.tsx` | 新 state `handEdited` / `confirmRegenerate`；新增 `applyDraft()`（程序性写入统一走它，顺带清 `handEdited`）、`regenerateFromTemplate()`、`handleRegenerateClick()`；`#jks-prefix` 的 `onChange` 简化成只 `setPrefix`；同排加「按模板重新生成」按钮；`PairListEditor` 的 `onChange` 里置 `handEdited`；末尾挂一个 `ConfirmDialog` |
| `app/src/renderer/src/screens/ChannelsScreen.tsx` | 新 state `confirmTemplate`；新增 `handleApplyTemplateClick()`；「按模板生成」按钮改指它；末尾挂一个 `ConfirmDialog` |

确认按钮文案分别是 `覆盖生成`（渠道配置页）与 `重新生成`（jks 弹窗），都不是笼统的「确定」。

### 实测（开发构建 + 打包版，页面错误 `[]`）

夹具：`jks.json` 一条 `id=t17` / app `测试应用` / alias `t17key`；`channels/t17.json` 两条；模板用首次读取时落的 13 项种子。

| 场景 | 结果 |
|---|---|
| 渠道配置：列表刚从磁盘读入（未改过）点「按模板生成」 | 不弹框，直接生成 13 条 |
| 渠道配置：手改第一行为 `EDITED_MARK` 后再点 | 弹「按模板生成？…覆盖后就没了。」，按钮为 `取消` / `覆盖生成` |
| 渠道配置：上一步点「取消」 | 列表不动，首行仍是 `EDITED_MARK` |
| 渠道配置：再点并选「覆盖生成」 | 首行回到 `t17_jl_flow`，共 13 条 |
| jks 弹窗：选入 jks → 切「套用模板」 | 13 条，首行 `t17_jl_flow` |
| jks 弹窗：把前缀改成 `zzz` | **行数与首行都不变**（改前缀不再重算） |
| jks 弹窗：点「按模板重新生成」（未手改） | 不弹框，首行变 `zzz_jl_flow` |
| jks 弹窗：手改成 `EDITED_MARK` 后再点 | 弹「按模板重新生成？…你在下面改过 13 条…」，按钮为 `取消` / `重新生成` |
| jks 弹窗：「取消」→ 再点 → 「重新生成」 | 取消后仍是 `EDITED_MARK`；确认后回到 `zzz_jl_flow` |
| 打包版复跑渠道配置那四条 | 全部一致；打包版里「新增 jks」的渠道数据来源下拉仍按预期在未选文件时 `disabled` |

## 后续增强：交付说明（2026-10-08 七续）

审计 P1 清单里的 P1-3「exe 签名与 SmartScreen」，验收标准是二选一：写清「更多信息 → 仍要运行」，或让 exe 有有效的 Authenticode 签名。

**结论：只做前者，证书不处理。** 买代码签名证书要花钱且要过组织审批；自签名证书对 SmartScreen 完全无效（它只认受信任 CA 签发的），所以自签这条捷径不存在。

改动：

| 文件 | 内容 |
|---|---|
| `交付说明.md` | **新增**。给拿到 exe 的同事看：① 拷到固定目录再运行（便携版把 `data/` 写在 exe 旁边，桌面/下载目录会被清理）；② SmartScreen 拦截的过法（「更多信息 → 仍要运行」），以及浏览器「不常见的下载」、杀软白名单、右键属性「解除锁定」；③ `data/` 里各文件分别含什么（明文口令、私钥副本、日志里的本机路径），只发 exe 不发 `data/` |
| `README.md` | 「已知注意事项」开头加一节，说明拦截的原因并链到 `交付说明.md` |

没有代码改动，因此不重建 exe。

## 后续增强：渠道列表搜索与排序（2026-10-09）

审计 P2 清单里的 P2-1「渠道列表搜索与排序」，风险一栏写的是「过滤状态下保存容易漏条目」。

三处口径：

| 问题 | 结论 |
|---|---|
| 搜索与排序放哪 | 放进 `PairListEditor` 组件内部。四个调用点里三个是「键 + 别名」同形列表，组件内部过滤后 `onChange` 仍吐**完整列表**，调用点零改动就得到正确语义；反过来在外层过滤再把子集传进去，就得在每个调用点重写一遍「可见行编辑合并回全表」 |
| 排序动不动 `rows` | 不动。`rows` 是保存内容的唯一来源，按别名排序若写回 `rows`，等于顺手改掉了文件里的行序 |
| 怎么堵「过滤状态下保存漏条目」 | 三层：① 工具条下一行写明「搜索与排序只改显示，保存的仍是全部 N 项」；② 计数变成「显示 X / 共 N 项」；③ **保存被校验拦下时（空渠道名 / 渠道名重复）自动清掉搜索** —— 否则出问题的那一行可能正被搜索藏着，用户只会看到「保存没反应」 |

其它细节：

- **`pickedIds` 按 `visibleRows` 过滤而不是 `rows`**：被搜索藏起来的行若还留在选中集合里，一点「删除选中」就会连看不见的行一起删掉。换搜索词/排序时同时清空选中，避免「清掉搜索后旧选择又冒回来」。
- **表头全选只选显示中的行**，筛选时 `title` 改成「全选显示中的行」。
- **整表被替换时自动清掉搜索**：判据是「旧 rowId 一个都不在了」而不是「rows 变了」—— 逐字改一行、删一行时 rowId 大多还在，不该把用户正用着的搜索词清掉。
- **「添加一行」后清掉搜索**：新行是空的，多半匹配不上当前搜索词，不露出来会让人以为没加上。
- **别名排序时空别名沉底**：别名是选填的，否则一屏全是空行，排好序的那半截反而看不见。
- **导入预览框（`ChannelListPreviewDialog`）刻意不开 `filterable`**：刚导入完要的是逐条核对，过滤只会让人漏看。

改动：

| 文件 | 内容 |
|---|---|
| `app/src/renderer/src/lib/row-view.ts` | **新增**。`RowSort = 'none' \| 'key' \| 'alias'`；`Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })` 做比较（中文按拼音、渠道号里的数字按大小）；`compareByKey` / `compareByAlias`（单侧空则空的排后，两侧空回退按渠道号）；`viewPairRows(rows, query, sort)` —— 查询串去空白转小写后对 `key` 与 `alias` 做 `includes`，`'none'` 表示保持原行序 |
| `app/src/renderer/src/components/PairListEditor.tsx` | 新增 `filterable?: boolean` 与 `resetFilterToken?: number` 两个 prop；工具条（带放大镜图标的搜索框 `aria-label="搜索条目"`、`aria-label="排序方式"` 的下拉、筛选时的「清空」）；表体渲染 `visibleRows`，空态区分「本来就没有」与「没有匹配」；计数行渲染条件放宽成 `selectable \|\| filterable` |
| `app/src/renderer/src/screens/ChannelsScreen.tsx` | 加 `filterable`；`handleSave` 两个拦截分支前递增 `filterResetToken`；`CardDescription` 改成「保存写的是整份列表，与搜索无关」（条数交给组件自己的计数行） |
| `app/src/renderer/src/screens/TemplateScreen.tsx` | 加 `filterable` |
| `app/src/renderer/src/components/JksFormDialog.tsx` | 加 `filterable` 与 `resetFilterToken`；`handleSubmit` 两个拦截分支前递增 |

实测（开发构建 + CDP 驱动，夹具 6 条渠道含一条无别名，页面错误 `[]`）：

| 场景 | 结果 |
|---|---|
| 搜别名「华为」/ 搜渠道号「hw」 | 都是 `显示 1 / 共 6 项`，只剩 `t19_hw` —— 渠道号与别名都参与匹配，大小写不敏感 |
| 搜「zzz」 | `显示 0 / 共 6 项` + 「没有匹配「zzz」的条目。换个词，或点「清空」。」 |
| 按渠道号排序 | `gf, hw, oppo, vivo, xm, zz` |
| 按别名排序 | `阿里, 官方, 华为, 小米, OPPO, (空)` —— 拼音序正确，空别名沉底 |
| 回「按原顺序」 | 恢复文件里的原行序 |
| 过滤后全选 + 删除选中 | 只删掉显示中的那 1 条，其余 4 行一条没动 |
| 空行被搜索藏起来后点保存 | 状态行报「渠道名不能为空，空行已经标红。」，同时搜索被清空、空行重新可见 |
| 搜索状态下点「添加一行」 | 搜索清空，新行可见 |
| 搜索状态下点「按模板生成」（整表替换） | 搜索清空，13 行模板渠道 |
| 渠道模板页 / 新增 jks 弹窗 | 工具条同样存在；弹窗未选 jks 文件时搜索框随 `noJks` 一起禁用 |

## 后续增强：读坏的配置文件要报错（2026-10-09 八续）

审计 P2 清单里的 P2-3「`jks.json` 写坏时界面明确报错并给路径，而不是静默当空列表」，风险一栏写的是「要区分『不存在』与『损坏』」。

起因：旧 `store.ts` 里三个读函数都是 `readJson<T>()` 返回 `T | null`，把「文件不存在」和「文件在但解析失败」混成同一个 `null`。于是 `jks.json` 被写坏时，界面只会显示「已配置 0 个 jks」——看起来像配置整个丢了，用户第一反应是「我的凭据呢」，而不是「这个文件坏了」。更糟的是 `readTemplate()` 里那句「`!parsed` 就落种子」会把坏掉的 `template.json` **静默覆盖成种子**，等于顺手删掉用户自己攒的模板。

三处口径：

| 问题 | 结论 |
|---|---|
| 怎么区分「不存在」与「坏了」 | `readJson` 从「一律返回 null」改成返回 `{value, problem}`：`ENOENT` 视为正常（那是「还没配过」），其它 fs 错误与 `JSON.parse` 失败才算 problem。结构不对（缺 `items` / `suffixes` / `channelInfoList`）同样算 problem |
| 坏文件要不要保住 | 要。`rescueBrokenFile` 先把原文件复制成 `<文件名>.broken` 再继续；**固定名 + 只在还没有备份时复制** —— 反复坏掉时保留最早那份，也不会让备份无限堆积。不备份的话，用户看到「0 个 jks」后随手新增一个，`writeJksFile` 就把坏文件覆盖掉了 |
| 原文件动不动 | 一个字节都不动。报错后按空列表继续，让用户自己决定修还是删 |

其它细节：

- **`readTemplate()` 不再覆盖坏文件**：坏掉时只在内存里退回种子，**绝不写盘**；只有「文件不存在」（首次启动）才落种子。
- **问题收集用模块级数组 + drain**：`noteProblem`（按 path 去重）+ `drainStoreProblems()`。`storeLoad` 先读 jks / template 再 drain 一次取走；渠道列表是按需逐个读的，所以另开一个 IPC `store:takeProblems`，渲染层在 `getChannels` 之后补取一次。
- **横幅可关但新问题会重新冒出来**：dismiss 状态按 path 记，放在组件本地 state，不落盘。

改动：

| 文件 | 内容 |
|---|---|
| `app/src/shared/types/store.ts` | 新增 `StoreProblem { label; path; reason; backupPath? }`（label 是给用户看的角色名，如「jks 列表」「渠道列表（xklinai）」）；`StoreSnapshot` 增加 `problems` |
| `app/src/main/store.ts` | 新增 `pendingProblems` / `noteProblem` / `drainStoreProblems` / `rescueBrokenFile` / `makeProblem`；`readJson` 改成返回 `ReadOutcome<T> = { value; problem }`；`readJksFile` / `readTemplate` / `readChannels` 三者按上述规则改写，`seedTemplate()` 抽出 |
| `app/src/main/ipc/store.ts` | `storeLoad` 先读 jks 与 template、**再** drain（顺序不能反）；新增 `storeTakeProblems` handler |
| `app/src/shared/constants/channels.ts` | 新增 `storeTakeProblems: 'store:takeProblems'` |
| `app/src/preload/preload.ts`、`app/src/shared/types/api.ts` | 新增 `takeStoreProblems()` |
| `app/src/renderer/src/store/app-store.tsx` | 新增 `problems` state 与 `mergeProblems`（按 path 去重合并）；`getChannels` 改成 `async`，读完配置再 `mergeProblems(await window.api.takeStoreProblems())` |
| `app/src/renderer/src/components/StoreProblemBanner.tsx` | **新增**。根节点带 `data-slot="store-problem-banner"`；标题写清有几个文件读不出来、原文件没动、备份已留；每条列出 `角色名 · 原因`、绝对路径、备份路径；按钮「打开数据目录」与「知道了」 |
| `app/src/renderer/src/App.tsx` | 在 `usedFallback` 横幅之后渲染 `<StoreProblemBanner />` |

实测（开发构建 + CDP 驱动，页面错误 `[]`）：

| 场景 | 结果 |
|---|---|
| `jks.json` 与 `template.json` 都是坏 JSON | 横幅「有 2 个配置文件读不出来…」，两条分别报 `不是合法的 JSON（…position 38…）` 与 `不是合法的 JSON（Unexpected token 'h'…）`，各带绝对路径与 `.broken` 备份路径 |
| 磁盘核对 | `jks.json`（38 B）与 `template.json`（23 B）**内容原样未改** —— 旧代码会把坏掉的 `template.json` 覆盖成种子；两个 `.broken` 与原文逐字一致 |
| 合法 JSON 但缺 `items` | 报「结构不对：缺少 items 数组」，原文件保住 |
| 备份只做一次 | 先写 `BROKEN-ONE` 重载 → `.broken` = `BROKEN-ONE`（10 B）；再写 `BROKEN-TWO` 重载 → `.broken` 仍是 `BROKEN-ONE` |
| `jks.json` 与 `template.json` 都不存在 | 无横幅；`template.json` 重新落种子（13 项）；`jks.json` **不被创建** |
| 好的 `jks.json` + 坏的 `channels/t21.json` | 报「渠道列表（t21）·不是合法的 JSON（Unexpected end of JSON input）」。**出包页挂载时就会读当前 jks 的渠道列表**（`PackScreen.tsx` 的 `getChannels(jksId)`），所以不用切到「渠道配置」页问题就已经冒出来了 |
| 点「打开数据目录」 | 资源管理器窗口数 6 → 7，新窗口地址 `file:///D:/工具/渠道分包工具/data` |
| 点「知道了」 | 横幅消失（`{"present":false}`） |
| 全部文件正常 | 无横幅，「已配置 1 个 jks」正常读出 |

验证手法上的一条教训：核对磁盘文件内容时用 `[System.IO.File]::ReadAllBytes` + `[System.Text.Encoding]::UTF8.GetString` 直接打印字节数与原文，别用 `"…$((Get-Content $p -Raw))…"` 这种嵌套引号插值 —— 后者一度打出空串，让人误以为备份文件是空的。

## 风险与回滚点

| 风险 | 触发点 | 回滚/对策 |
|---|---|---|
| `data/` 写错位置，重启丢配置 | 阶段 7 | 阶段 2 就用 `PORTABLE_EXECUTABLE_DIR` 为基准（不用 `app.getPath('exe')`，那指向 `%TEMP%` 解压目录）；阶段 7 必测「关掉重开」 |
| 随手把整个目录发出去，连带泄露 25 个私钥与明文密码 | 阶段 7 | 分发以「单个 exe」为单位；配置另走配置包，导入前明确提示含私钥 |
| 中文掉到系统默认字体，与参考站观感脱节 | 阶段 4 | 字体栈显式含 `"Microsoft YaHei UI"` 等中文回退；阶段 4 走查时确认 |
| keytool GBK 输出解析失败 | 阶段 3 | 显式指定编码解码；解析失败时降级为「仅提示校验结果，不回填别名」 |
| 中文路径在子进程参数中损坏 | 阶段 5 | 用 `spawn` 数组参数；日志按 UTF-8 落盘 |
| JDK 下载 182 MB 拖慢首次构建 | 阶段 0 | `prepare-runtime.ps1` 幂等，已存在则跳过；裁剪完成后立即删除临时 JDK |
| 构建机没有 Android SDK，拿不到 `zipalign.exe` / `apksigner.jar` | 阶段 0 | 二者合计仅 2.0 MB，可直接纳入版本库作为兜底 |
| `jlink` 模块集漏项，签名时才失败 | 阶段 0 | 已实测固定为 `java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`；升级 apksigner 后需用真实签名回归 |
| 端到端回归缺少真实 APK | 阶段 5 | **已解决**：`示例应用_V1.4.6_20260916_1727.apk` 已就位，且整条流水线已在规划阶段跑通 |

## 明确的非目标

- 不修改现有 `APK拖动到此分包.bat`、`channelConfig.sample.json`、任何 `.jks`。
- 不做 APK 二次加固、渠道数据回传统计、云端账号、密码加密存储。
- 不做多 APK × 多 jks 笛卡尔积批量。
