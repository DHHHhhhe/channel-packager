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
> **「导入 JSON」落在渲染层**：用 `<input type="file">` + `file.text()` 读内容，不走 `channels:import` IPC（那是阶段 6 配置包导入用的）。K3「原样导入」照办，只取 `channelInfoList`，`defaultExtraInfo.app` 仍取该 jks 的 `app`。

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

> **未能自动化的那一项**：打包版里「点导入配置包 → 原生对话框选包 → 预览 → 确认导入」这条链路没有跑通自动化，原因是本机**桌面会话处于锁屏状态**，且这个原生对话框把控件暴露成**没有任何 UIA Pattern 的 Pane**（文件名框 `class=Edit`、`AutoId=1001`，`GetSupportedPatterns()` 为空；保存按钮 `class=Button`、`AutoId=1`，无 `InvokePattern`），`WM_SETTEXT` 写进去也不生效。按键注入又只能送到锁屏界面。已确认到「点击 → `#32770` 对话框以正确标题弹出」这一步；对话框之后的逻辑由阶段 6 的测试入口覆盖（跑的是打包版所打包的同一份源码，导出/导入/冲突/SHA256 共 30 余项断言全绿）。若要补上这一段，需要一台解锁的机器，或用 `computer-use` 之类的系统级自动化。
>
> 另需补的收尾项：**应用图标**（现在分发出去是 Electron 默认图标），以及 README 里把「只发 exe」与「发 exe + 配置包」两种分发语义写清楚。

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
