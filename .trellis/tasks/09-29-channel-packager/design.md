# 技术设计：渠道分包工具 GUI 版

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│ Electron 应用（免安装 portable exe）                     │
│                                                         │
│  ┌───────────────────┐        IPC        ┌────────────┐ │
│  │ Renderer (UI)     │ ◄───────────────► │ Main (Node)│ │
│  │ React + shadcn/ui │  contextBridge    │            │ │
│  │ 拖拽 / 表格 CRUD  │  invoke/handle    │ 子进程编排 │ │
│  └───────────────────┘                   └─────┬──────┘ │
│                                                │        │
│  resources/bin/（随包分发，不依赖系统环境）    │        │
│   ├── jre/            (30.8 MB)                │        │
│   ├── zipalign.exe    (0.9 MB)                 │        │
│   ├── apksigner.jar   (1.1 MB)                 │        │
│   └── walle-cli-all.jar (0.6 MB)               │        │
└────────────────────────────────────────────────┼────────┘
                                                 │ child_process.spawn
                    ┌────────────────────────────▼─────────────────┐
                    │ jre/bin/java.exe -jar apksigner.jar ...      │
                    │ zipalign.exe -f 4 ...                        │
                    │ jre/bin/java.exe -jar walle-cli-all.jar ...  │
                    └──────────────────────────────────────────────┘
```

**关键约束**：所有子进程调用集中在 Main 进程。Renderer 不开 `nodeIntegration`，只通过 `preload` 暴露白名单 IPC。

## 目录结构

```
渠道工具/
├── APK拖动到此分包.bat          # 保留，作为行为参照
├── channelConfig.sample.json           # 保留，模板种子来源
├── *.jks (25 个)                # 保留，开发期测试素材
├── walle-cli-all.jar            # 保留
├── app/                         # Electron 工程（pnpm + TypeScript 严格模式）
│   ├── package.json
│   ├── .npmrc                   # node-linker=hoisted / shamefully-hoist=true
│   ├── tsconfig.json            # strict，禁 any / 禁非空断言
│   ├── vite.config.ts
│   ├── components.json          # shadcn/ui 配置
│   ├── electron-builder.yml
│   ├── scripts/
│   │   └── prepare-runtime.ps1  # 下载 Temurin JDK 17 + jlink 裁剪；复制 zipalign/apksigner
│   ├── src/
│   │   ├── main/
│   │   │   ├── index.ts         # 应用入口、窗口创建
│   │   │   ├── ipc/             # IPC handler 按域拆分（runtime/jks/channels/task/pack）
│   │   │   ├── paths.ts         # 数据目录解析（PORTABLE_EXECUTABLE_DIR / userData）
│   │   │   ├── store.ts         # 配置读写（jks / 渠道 / 模板）
│   │   │   ├── keystore.ts      # jks 副本导入、SHA256、来源刷新
│   │   │   ├── configpack.ts    # 配置包导入导出（zip）
│   │   │   ├── runtime.ts       # 内置运行时路径解析与环境自检
│   │   │   ├── signer.ts        # zipalign + apksigner 流水线
│   │   │   ├── walle.ts         # walle batch2 / batch / show 封装
│   │   │   ├── pipeline.ts      # 出包任务编排
│   │   │   └── logger.ts        # 日志落盘
│   │   ├── preload/
│   │   │   └── index.ts         # contextBridge 暴露 window.api
│   │   ├── shared/
│   │   │   ├── constants/channels.ts   # IPC 通道名唯一来源
│   │   │   └── types/                  # 主/渲染共用类型
│   │   └── renderer/
│   │       ├── index.html
│   │       └── src/
│   │           ├── main.tsx
│   │           ├── App.tsx
│   │           ├── components/ui/      # shadcn/ui 组件
│   │           ├── modules/            # pack / jks / channels / template
│   │           └── styles/
│   │               ├── index.css       # 唯一入口
│   │               ├── tokens.css      # 设计令牌（light/dark）
│   │               └── base.css
│   └── resources/
│       └── bin/                 # 构建时由 prepare-runtime.ps1 填充，不入版本库
└── .trellis/                    # 规划文档
```

> **技术选型依据**：`.trellis/spec/frontend/` 规定 Electron 项目用 **TypeScript 严格模式 + pnpm**，IPC 一律走 `window.api` 且通道名集中在 `shared/constants/channels.ts`，组件上限 300 行、CSS 文件上限 500 行。本设计遵循这些约定。
>
> **规范中已过时的一条**：`spec/frontend/electron-browser-api-restrictions.md` 说 `File.path` 不可用、应"在主进程处理拖拽"。实际是 Electron 32+ **移除了** `File.path`，官方替代正是 `webUtils.getPathForFile`（在 preload 中调用）。本实现按官方方案，并在收尾阶段更新该 spec。

## 设计系统

**来源**：`https://studio-admin.arhamkhnz.com/dashboard/default`，shadcn/ui + Tailwind v4，Neutral 基色。以下数值是**从该站实测提取**的（`getComputedStyle` + CSS 自定义属性），不是截图估算。

### 颜色令牌

| 令牌 | Light | Dark |
|---|---|---|
| `--background` | `#ffffff` | `#0a0a0a` |
| `--foreground` | `#0a0a0a` | `#fafafa` |
| `--card` | `#ffffff` | `#171717` |
| `--muted` / `--accent` / `--secondary` | `#f5f5f5` | `#262626` |
| `--muted-foreground` | `#737373` | `#a1a1a1` |
| `--border` | `#e5e5e5` | `#ffffff1a` |
| `--input` | `#e5e5e5` | `#ffffff26` |
| `--primary` | `#171717` | `#e5e5e5` |
| `--destructive` | `#e40014` | `#ff6568` |
| `--ring` | `#a1a1a1` | `#737373` |
| `--sidebar` | `#fafafa` | `#171717` |
| `--sidebar-primary` | `#171717` | `#1447e6` |
| `--radius` | `0.625rem`（10px） | 同左 |

### 尺寸与排版

| 元素 | 实测值 |
|---|---|
| 侧边栏宽度 | `272px`（`--sidebar-width`） |
| 顶栏 | 高 `48px`，sticky，`bg-background/50` + 背景模糊，底部 1px 边框 |
| 卡片 | 圆角 `14px`、纵向内边距 `12px`、`gap 12px`、1px ring、header `px-4` |
| 卡片标题 | `14px / 500` |
| 卡片描述 | `14px / 400`，`--muted-foreground` |
| 按钮 | 高 `36px`、圆角 `10px`、`14px / 500` |
| 徽章 | 高 `20px`、全圆角、`12px / 500`、1px 边框 |
| 表头 | 高 `44px`、`px-3`、`14px / 500` |
| 单元格 | `padding 12px`、`14px / 400` |
| 输入框 | 圆角 `8px`、`14px`；工具栏内的紧凑型高 `28px` |

### 字体

参考站用 **Geist**（`--font-sans`）+ Geist Mono。**但 Geist 不含中文字形**，而本应用界面是中文，必须显式配置回退栈：

```css
--font-sans: "Geist", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
```

Geist 的 Latin 子集自托管（woff2，约 30–50 KB，**不引 CDN** —— 应用须离线可用），中文交给系统字体。

### 落地方式

- 令牌以 CSS 变量写在 `renderer/styles.css`，Tailwind v4 用 `@theme inline` 映射，shadcn/ui 组件直接消费，**不逐处硬编码色值**。
- 组件通过 `npx shadcn@latest add button card dialog table badge checkbox select input label separator` 引入，源码进 `components/ui/`，可改。
- 默认 light 主题；dark 令牌一并写好，切换按钮后置（成本低，令牌已具备）。

## 数据模型

### 存储位置（R24）

便携版 exe **每次启动自解压到 `%TEMP%`**，因此 `path.dirname(app.getPath('exe'))` 指向的是临时目录，数据写进去下次启动就没了。必须改用 electron-builder 注入的 `PORTABLE_EXECUTABLE_DIR`（[electron-builder 文档](https://electron-userland-electron-builder-63.mintlify.app/packaging/windows)、[issue #1612](https://github.com/electron-userland/electron-builder/issues/1612)）。

```js
// src/main/paths.js
const base =
  process.env.PORTABLE_EXECUTABLE_DIR            // 打包后：exe 真实所在目录
  ?? path.dirname(app.getPath('exe'));           // 开发态：工程目录内

const dataDir = path.join(base, 'data');

// 必须同步 userData，否则 Chromium 缓存仍会另落一份到 %APPDATA%
app.setPath('userData', path.join(dataDir, '.runtime'));
```

`data/` 不可写时（如放在 `Program Files`）回退 `app.getPath('userData')`，并在界面明示当前使用的路径。

**`data/` 是自包含的**：jks 副本、凭据、渠道列表全在里面，整目录拷走即可迁移（R21）。`.runtime/` 单独放 Chromium 缓存与 Cookie，与业务数据分开，**导出配置包时不包含它**。

```
data/
├── jks.json                 # jks 列表 + 凭据 + app
├── template.json            # 固定模板（全局一份）
├── keystores/               # jks 副本，应用只用这里的文件
│   ├── sample.jks
│   └── demo.jks
├── channels/
│   ├── sample.json            # 每个 jks 一份，channelConfig.sample.json 格式
│   └── demo.json
├── logs/
│   └── 2026-09-29T15-44-11_sample.log
└── .runtime/                # Chromium 缓存 / Cookie，导出配置包时排除
```

### `data/jks.json`

```json
{
  "version": 2,
  "items": [
    {
      "id": "sample",
      "displayName": "sample.jks",
      "keystoreFile": "keystores/sample.jks",
      "sourcePath": "D:\\keys\\sample.jks",
      "sha256": "3f2a…",
      "fileSize": 2532,
      "alias": "sample",
      "storePassword": "sample@123",
      "app": "sample",
      "credentialSource": "derived",
      "importedAt": "2026-09-29T15:44:11+08:00"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 稳定标识，默认取 jks 文件名去扩展名；`channels/<id>.json` 以它命名 |
| `keystoreFile` | **相对 `data/` 的副本路径 —— 这是签名与凭据校验唯一使用的路径** |
| `sourcePath` | 原文件位置，**仅供显示与「从原文件重新导入」使用**，不参与签名 |
| `sha256` / `fileSize` | 导入时的指纹。刷新时与 `sourcePath` 现内容比对，提示是否已变化；**不自动同步** |
| `alias` / `storePassword` | 可编辑。新增时按 `<id>@123` + `<id>` 自动推导并填入输入框，用户可改（`legacy.jks` 这类例外靠手工覆盖） |
| `credentialSource` | `derived` = 来自规律推导；`manual` = 用户手工填过。仅用于界面提示，不参与逻辑 |
| `app` | 写入 walle `defaultExtraInfo.app`；新建时默认取 `id`，可编辑 |

### jks 副本的生命周期（R21 / K12）

| 动作 | 行为 |
|---|---|
| 新增 | 复制源文件到 `data/keystores/<id>.jks`，记录 `sha256` / `fileSize` / `sourcePath`。同 `id` 且 SHA256 相同 → 提示已存在并跳过；同 `id` 但 SHA256 不同 → 自动改用 `<id>_2`，**不覆盖** |
| 出包 / 凭据校验 | **只用 `keystoreFile`**，从不读 `sourcePath` |
| 刷新 | 点「从原文件重新导入」→ 读 `sourcePath` 算 SHA256 → 与记录比对 → 相同则提示「未变化」，不同则提示「已变化」并由用户确认是否覆盖副本 |
| 源文件已被移动 / 删除 | 刷新按钮提示「原文件不可访问」，**完全不影响出包** |
| 删除 jks | 一并删除 `jks.json` 条目、`channels/<id>.json` 与 `keystores/<id>.jks` |

> **安全含义**：`data/` 现在同时装着 25 个签名私钥的副本与明文密码（K4）—— 整个目录拷给谁，谁就能以这些身份签名。工作目录 `渠道工具\` 本来就把 25 个 jks 放在一起，所以暴露面没有实质变化，但这个目录现在值得当成敏感数据对待。

### 配置包（R25 / K15）

**分发的两种语义要分清**：

| 你要做的事 | 发什么 | 对方拿到 |
|---|---|---|
| 给别人一个工具 | **只发 exe** | 干净工具，无任何 jks 与渠道，自己添加 |
| 把自己的整套配置搬过去 | 发 exe **+ 导出的配置包** | jks 副本、渠道列表、模板全部还原 |

**配置包结构**（`渠道配置包_2026-09-29.zip`）：

```
manifest.json          # 版本、导出时间、jks 数量、SHA256 校验表
jks.json               # 凭据与 app 标识（含明文密码，见下方提示）
keystores/*.jks        # jks 副本
channels/*.json        # 每个 jks 的渠道列表
template.json          # 模板
```

**导入行为**：

- 校验 `manifest.json` 里每个文件的 SHA256，不匹配即中止并说明是哪个文件。
- 与现有数据冲突时**不静默覆盖**：同 `id` 且 SHA256 相同 → 跳过；同 `id` 但内容不同 → 让用户选择「跳过 / 保留两份（自动加后缀）/ 覆盖」。
- 导入完成后立即刷新界面列表。

> **导入前必须提示**：配置包内含**明文密码与私钥**，导入等于把对方的签名身份装进本机。界面上要在导入按钮旁直接写明，不能只在文档里说。

### `data/channels/<id>.json`

**严格复用 `channelConfig.sample.json` 结构**，这样导出/导入零转换：

```json
{
  "defaultExtraInfo": { "app": "sample" },
  "channelInfoList": [
    { "channel": "sample_jl_flow", "alias": "巨量" },
    { "channel": "CPS00001" }
  ]
}
```

### `data/template.json`

```json
{
  "version": 1,
  "suffixes": [
    { "suffix": "jl_flow", "alias": "巨量" },
    { "suffix": "ks_flow", "alias": "快手" },
    { "suffix": "gf", "alias": "官方" }
  ]
}
```

套用模板生成副本时：`channel = <用户填的前缀> + "_" + suffix`，`alias` 原样带过。**副本是深拷贝**，与模板无引用关系（K1）。前缀为空时退化为 `channel = suffix`。

## 出包流水线

```
任务输入: { apkPath, jksId, channelCodes[], signMode, outputDir }
```

| 步骤 | 动作 | 失败处理 |
|---|---|---|
| 1 | 校验 `apkPath` 存在且后缀 `.apk`；校验 `jksId` 存在、凭据非空、**`keystoreFile` 副本存在** | 立即返回明确错误 |
| 2 | 建**唯一**工作目录 `<outputDir>\.work\<taskId>`（`taskId` = 时间戳 + 随机后缀） | —— |
| 3a | `zipalign -f 4 <apk> <work>/aligned.apk` | 中止，保留日志 |
| 3b | `java -jar apksigner.jar sign --ks <data/keystores/<id>.jks> --ks-key-alias <alias> --ks-pass pass:<pw> --key-pass pass:<pw> --v2-signing-enabled true --out <work>/signed.apk <work>/aligned.apk` | 中止，保留日志 |
| 3c | `java -jar apksigner.jar verify -v <work>/signed.apk` | 中止，保留日志 |
| 3d | 把 `signed.apk` 复制为 `<work>/<原包名>.apk` | 中止 |
| 3e | 另存 `<apkDir>/<原包名>_resigned.apk` | 仅告警，不中止 |
| 4 | 写 `<work>/channel.json`：`defaultExtraInfo.app` 取该 jks 的 `app`，`channelInfoList` 只含勾选的渠道 | —— |
| 5 | `java -jar walle-cli-all.jar batch2 -f <work>/channel.json <work>/<原包名>.apk <work>/out` | 中止，保留日志 |
| 6 | 逐个 `walle-cli show` 校验产物渠道号，与预期比对 | 不匹配则告警并在结果中标记 |
| 7 | 把 `<work>/out/*.apk` 移动到 `outputDir` | —— |

**`signMode = skip` 时跳过 3a–3e，第 5 步的输入直接用 `apkPath`。**

### 为什么第 3d 步要用原包名

walle 输出名 = `<输入包名>_<别名>.apk`（反汇编确认）。若直接拿 `_resigned.apk` 去跑 walle，产物会变成 `<原包名>_resigned_应用宝.apk`，就得像 bat 那样再加一段正则清理。**在临时目录里把重签名结果还原成原包名**，产物名天然正确，从根上消掉这个问题（K5）。

### 为什么不直接输出到 `outputDir`

先落到 `<work>/out` 再移动，是为了在发布前用 `walle show` 校验渠道号（第 6 步）。校验不过的包不会污染输出目录。

## 内置运行时

### 路径解析（`runtime.js`）

```js
// 开发期：app/resources/bin；打包后：process.resourcesPath/bin
const BIN = app.isPackaged
  ? path.join(process.resourcesPath, 'bin')
  : path.join(__dirname, '../../resources/bin');

const JAVA       = path.join(BIN, 'jre', 'bin', 'java.exe');
const KEYTOOL    = path.join(BIN, 'jre', 'bin', 'keytool.exe');
const ZIPALIGN   = path.join(BIN, 'zipalign.exe');
const APKSIGNER  = path.join(BIN, 'apksigner.jar');
const WALLE      = path.join(BIN, 'walle-cli-all.jar');
```

启动自检：逐个 `fs.existsSync`，收集缺失项，界面顶部横幅提示具体缺哪个（R17）。**全程不读 `JAVA_HOME` 与 `PATH`**（消掉 bat 缺陷 B3）。

### 获取方式（`scripts/prepare-runtime.ps1`）

**JRE 由构建脚本自行产出，不从本机任何安装中复制。** 本机的 Java 完全依附 Android Studio 的 jbr（`Program Files\Java`、Adoptium、Microsoft JDK、SDK 自带 jdk/jre 均不存在），而 Android Studio 带 `uninstall.exe` —— 卸载后复制方案即失效。

```
1. 下载 Temurin JDK 17（Windows x64 zip，182 MB）
   https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse
2. 解压到临时目录（该 JDK 自带 71 个 jmod；jbr 没有 jmods，所以 jlink 裁不了它）
3. jlink --add-modules java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool `
         --output resources/bin/jre `
         --strip-debug --no-header-files --no-man-pages --compress=2
   → 30.8 MB
4. 清理临时 JDK（182 MB zip 与解压产物）
```

| 目标 | 来源 | 依赖本机安装 |
|---|---|---|
| `resources/bin/jre/` | **下载 Temurin JDK 17 + `jlink` 裁剪** | **否** |
| `resources/bin/zipalign.exe` | `...\Android\Sdk\build-tools\37.0.0\zipalign.exe` | 是（构建机需有 SDK） |
| `resources/bin/apksigner.jar` | `...\build-tools\37.0.0\lib\apksigner.jar` | 是（同上） |
| `resources/bin/walle-cli-all.jar` | 工作目录现有 | 否 |

脚本要求：下载做 SHA256 校验；已存在且体积匹配则跳过（幂等）；结束时打印各组件体积与合计。

> **可选的进一步解耦**：`zipalign.exe` + `apksigner.jar` 合计仅 2.0 MB，可直接纳入版本库，这样构建就完全不依赖本机 SDK。是否这么做待定，不影响运行时行为。

### 模块集是怎么定的

`jdeps --print-module-deps` 给出 walle 需 `java.base,java.sql`、apksigner 需 `java.base,java.logging`。但 **crypto 走反射，`jdeps` 看不到**，因此补了 `jdk.crypto.ec`，并用真实签名验证 —— 实测 `sign` 退出码 0、`verify` v2 通过。`jdk.jartool` 用于提供 `keytool.exe`（凭据校验功能依赖它）。

若日后升级 apksigner，模块集需要重新用真实签名回归，不能只看 `jdeps`。

### 凭据即时校验

新增/编辑 jks 时，用内置 `keytool` 跑一次 `keytool -list -keystore <jks> -storepass <pw>`：

- 成功 → 界面显示绿色「凭据校验通过」，同时读出真实别名回填。
- 失败 → 红色提示「密码或别名不正确」，**在保存前拦住**，避免出包跑到第 3b 步才失败。

这条直接对应验收项「选中 `legacy.jks` 且密码未录入时给出明确提示」。

## 拖拽取真实路径

Electron 32 起 `File.path` 已被移除，拖拽必须在 preload 里暴露 `webUtils.getPathForFile`：

```js
// preload
const { contextBridge, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pathForFile: (file) => webUtils.getPathForFile(file),
  // ...
});
```

```js
// renderer drop handler
const file = e.dataTransfer.files[0];
const apkPath = window.api.pathForFile(file);   // 真实绝对路径
```

这是必须走 preload 的硬约束 —— 渲染进程拿不到路径，`walle` / `apksigner` 都需要真实路径。

## IPC 接口（白名单）

| 通道 | 方向 | 用途 |
|---|---|---|
| `runtime:check` | invoke | 返回内置组件自检结果 |
| `store:load` | invoke | 读取 jks 列表 + 模板 |
| `store:saveJks` | invoke | 新增/更新/删除 jks（新增时复制文件到 `data/keystores/`，删除时一并删副本） |
| `jks:refreshFromSource` | invoke | 从 `sourcePath` 重新读取并与记录的 SHA256 比对，返回「未变化 / 已变化 / 原文件不可访问」 |
| `store:getChannels` | invoke | 读某 jks 的渠道列表 |
| `store:saveChannels` | invoke | 保存某 jks 的渠道列表 |
| `store:saveTemplate` | invoke | 保存固定模板 |
| `channels:import` | invoke | 从 JSON 文件导入渠道（原样复制） |
| `channels:export` | invoke | 导出某 jks 的渠道为 JSON |
| `cred:verify` | invoke | 用 keytool 校验 jks 凭据 |
| `task:run` | invoke | 启动出包任务，返回 `taskId` |
| `task:progress` | send → renderer | 推送阶段与实时输出行 |
| `walle:show` | invoke | 查看指定 APK 的渠道信息 |
| `pack:export` | invoke | 导出配置包 zip（jks 副本 + 渠道 + 模板 + manifest） |
| `pack:import` | invoke | 导入配置包 zip，校验 SHA256 并处理冲突 |

## 打包

`electron-builder`，目标 `portable`（免安装单 exe）：

```yaml
appId: com.example.channelpackager
productName: 渠道分包工具
win:
  target: portable
portable:
  artifactName: 渠道分包工具-${version}.exe
extraResources:
  - from: resources/bin
    to: bin
```

**产物体积预期 ≈ 185 MB**（Electron ≈ 150 MB + 内置运行时 ≈ 33.4 MB）。

`portable` 目标**每次启动都自解压到 `%TEMP%`**，所以 `data/` 绝不能以 `process.resourcesPath` 或 `app.getPath('exe')` 为基准 —— 那指向的是临时目录，用户加完 jks 一关就没了。必须用 `PORTABLE_EXECUTABLE_DIR`（见「存储位置」）。实现后必须做「关掉应用重开，配置仍在」的验证。

**分发形态**（K15）：默认产出单个 portable exe。**发给别人只发这一个 exe 就是干净工具**；要连配置一起给，另用应用内的「导出配置包」生成 zip，对方导入即可。不要把整个文件夹当作分发单位 —— 那等于把 25 个私钥和明文密码一起发出去。

## 兼容性与迁移

- `data/channels/<id>.json` 与现有 `channelConfig.sample.json` 同构，因此**现有配置可直接被本应用导入**，本应用导出的配置也可直接被现有 bat 的 `batch2 -f` 消费（R14/R15）。
- 现有 bat 与 jks 文件**保持原样不动**，可继续独立使用，迁移是渐进的。
- 本应用不修改任何现有文件，只在 `data/` 下新建自己的数据。

## 风险与对策

| 风险 | 对策 |
|---|---|
| portable exe 解压到 `%TEMP%`，`data/` 写错位置导致重启丢配置 | 以 `PORTABLE_EXECUTABLE_DIR` 为基准并同步 `app.setPath('userData')`；实现后必须做「关掉应用重开，配置仍在」的验证 |
| 随手把整个目录发给别人，连带泄露 25 个私钥与明文密码 | 分发以「单个 exe」为单位；配置另走配置包，导入前明确提示含私钥 |
| 中文路径与中文文件名（`示例应用_V1.4.6_..._应用宝.apk`）在子进程参数中乱码 | **已实测**：参数传递本身正常 —— `walle batch2` 对中文名 APK 全流程 exit 0，产物名正确。但 walle **回显路径时按控制台代码页输出**，捕获 stdout 会看到乱码。对策：`spawn` 用数组参数、不经 shell 拼接；捕获输出按 GBK 解码后再展示；**不要拿回显的路径做任何逻辑判断**，路径以自己持有的变量为准 |
| walle 写入的渠道号与预期不符 | 第 6 步用 `walle show` 逐个校验，不一致就在结果中标记 |
| JDK 下载 182 MB 拖慢首次构建 | `prepare-runtime.ps1` 幂等：目标已存在且体积匹配则跳过；裁剪完成后立即删除临时 JDK |
| `legacy.jks` 密码未知导致该 jks 不可用 | 设计上按手工录入处理，界面明确提示，不影响其他 24 个 jks |
