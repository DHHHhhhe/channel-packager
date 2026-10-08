# 渠道分包工具

免安装的 Android 渠道分包工具。把一个 APK 拖进来，按每个签名证书各自的渠道列表写入渠道信息并重签名，输出一批渠道包。

用来替代原来的 `APK拖动到此分包.bat`。

## 和原脚本的区别

|            | 原 bat                | 本工具                                        |
| ---------- | --------------------- | --------------------------------------------- |
| 口令       | 写在脚本里            | 每个 jks 独立保存，界面里可改                 |
| 渠道配置   | 一个全局 JSON          | 每个 jks 一份，互不干扰                       |
| 运行环境   | 依赖本机 Java 与 Android SDK | JRE / apksigner / zipalign / walle 全部内置 |
| 换机器     | 重配环境、改路径      | 只发 exe；或用配置包整体迁移                  |
| 新增渠道   | 手改 JSON             | 模板一键套用                                  |
| 出错排查   | 黑窗口滚过的输出      | 失败时卡片直接写出卡在哪一步与输出末尾，另有完整日志 |

## 使用

1. 下载 `渠道分包工具-<版本>.exe`，放到任意可写目录（建议单独建一个文件夹）
2. 双击运行
3. 到「签名配置」新增 jks：选择 `.jks` 文件，确认别名与口令，点「新增并校验」
4. 到「渠道配置」维护该 jks 的渠道列表；「渠道模板」维护后缀表，新增 jks 时可一键套用
5. 到「出包」把 APK 拖进去，勾选要出的渠道，点「开始出包」

侧边栏四个页面：

| 页面     | 作用                       |
| -------- | -------------------------- |
| 出包     | 选 APK 与渠道，开始分包    |
| 签名配置 | 每个 jks 的凭据与应用名    |
| 渠道配置 | 每个 jks 的渠道列表        |
| 渠道模板 | 新增 jks 时可套用的后缀表  |

### 几个好用的地方

| 位置 | 操作 | 说明 |
| ---- | ---- | ---- |
| 签名配置 → 新增 jks | 口令右侧的眼睛按钮 | 切换口令明文/密文，用来核对手抄错没有 |
| 签名配置 → 新增 jks | 「渠道数据」区块 | 选好 jks 文件后才可用；无论选「不套用模板 / 套用模板 / 导入 JSON」，下方始终是**最终会保存的列表**，可以直接增删改、也能勾选多行一次删掉；新增 jks 的同时就把渠道建好。选「导入 JSON」会先弹一个可编辑的预览框，改完点确认才落到这份列表上 |
| 渠道配置 / 渠道模板 | 勾选行 → 「删除选中」 | 表头是全选框，支持一次删多条 |
| 渠道配置 | 「导入 JSON」 | 弹出可编辑的预览框：条目就是文件里的内容，能直接增删改；同时选**覆盖**（默认，整表替换）还是**追加**（接到现有列表后面，同名渠道跳过）。确认后只填进页面列表，**不写文件** —— 和手工敲进去的一样，要再点「保存渠道列表」才落盘，所以不用担心导入会丢掉未保存的修改 |
| 渠道配置 | 「导出 JSON」 | 导出的是**界面上**的列表（含尚未保存的修改），不是磁盘上那份 |
| 渠道配置 | 渠道列表为空时的「导出示例 JSON」 | 给一份可以直接改的起点，条目取自「渠道模板」页的模板 + 当前前缀；改完用「导入 JSON」读回来 |
| 出包 | 「查看渠道」 | 弹窗显示包里的渠道号与额外信息；包里没写过渠道时直说，不会把文件路径当成渠道号 |
| 出包 | 失败时的结果卡片 | 直接写出**卡在哪一步、退出码是多少、那一步输出的末尾 15 行**，不用再去翻日志；旁边的「复制诊断信息」一键拷走，路径里的家目录会自动换成 `%USERPROFILE%`，可以直接贴给别人 |
| 出包 | 「跳过签名」 | 重签名时会顺手在原包旁边留一份 `<原包名>_已签名_未写渠道.apk`，下次把它拖进来、签名模式选「跳过签名」，就能省掉 zipalign + apksigner。出包前会先核对这份包的签名证书与所选 jks 是否一致，对不上直接中止 —— 否则会签出一批签名对不上的包，要到安装或覆盖更新时才发现 |
| 出包 | 输出目录里的 `.work/` | 每次点「开始出包」先把上一轮的 `.work/` 整个清掉，不会越堆越多；本次失败时保留，方便对着中间产物排查 |

### 数据放在哪

免安装版是单文件 exe，每次启动会自解压到 `%TEMP%`，但**数据目录固定在 exe 旁边**：

```
渠道分包工具-0.1.0.exe
data/
├── jks.json               # 每个 jks 的别名、口令、应用名
├── template.json          # 渠道后缀模板
├── keystores/<id>.jks     # jks 副本，签名与校验只用副本
├── channels/<id>.json     # 每个 jks 的渠道列表
├── logs/                  # 每次出包的完整日志
└── .runtime/              # Chromium 缓存，可删
```

整个文件夹拷走就是完整迁移；只拷 exe 就是一份干净的新工具（无证书、无渠道）。

jks 在「新增并校验」时会复制一份到 `data/keystores/`，之后签名只用副本 —— 原始 `.jks` 文件移走或删掉都不影响出包。

> ⚠️ **别在 `app/release/` 里双击刚构建出来的 exe。** 数据目录跟着 exe 走，会在构建产物目录里当场生成一份 `release/data/`，里面有 jks 副本与明文口令；而 `release/` 重建或清理时会被整个删掉，打包分享时也会被一起带走。把 exe 与 `data/` 一起放到仓库外的目录（例如 `桌面\渠道分包工具\`），从那里双击使用。构建脚本里已加了一道保险：检测到 `app/release/data/` 会直接中止构建并提示。

## 配置包

> 配置包内含**明文密码与私钥**。导出后只发给你信任的人；导入等于把对方的签名身份装进本机。

| 方式     | 内容                                            | 用途                     |
| -------- | ----------------------------------------------- | ------------------------ |
| 发 exe   | 干净工具，无任何证书与渠道                      | 给同事一份工具           |
| 发配置包 | jks 副本 + 凭据 + 渠道列表 + 模板，打成一个 zip | 换机器整体迁移、统一团队配置 |

导入前会校验 manifest 与每个文件的 SHA256，并列出冲突；冲突处理可选**跳过**、**保留两份**（新条目改名为 `<id>_2`）或**覆盖**。

## 从源码构建

### 前置

| 依赖                  | 说明                                                     |
| --------------------- | -------------------------------------------------------- |
| Node.js ≥ 20          | 开发用 Node v24 验证                                     |
| pnpm 11               | `packageManager` 已锁定 11.8.0                           |
| PowerShell 7          | 运行时准备脚本与图标生成脚本用                           |
| Android SDK build-tools | 只用来取 `zipalign.exe` 与 `apksigner.jar`             |
| 网络                  | `prepare:runtime` 需从 Adoptium 下载 Temurin JDK 17（约 182 MB） |

### 步骤

```powershell
git clone <repo>
cd <repo>/app

pnpm install
pnpm prepare:runtime   # 生成 resources/bin —— 未入库，必须执行一次
pnpm dev               # 开发模式
pnpm build             # 类型检查 + 打包渲染层
pnpm dist              # 出便携版 exe，产物在 release/
```

`app/resources/bin/` 不入库（33.4 MB），由 `pnpm prepare:runtime` 重建：

| 产物                                | 来源                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `jre/`                              | 从 Adoptium 下载 Temurin JDK 17，用 `jlink` 裁剪（模块集 `java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`） |
| `zipalign.exe`、`apksigner.jar`     | 本机 Android SDK build-tools 里版本号最高的正式版目录                        |
| `walle-cli-all.jar`                 | 仓库根目录（第三方构建，来源见「第三方组件」）                                                                 |

脚本幂等：产物存在且体积与 `resources/bin/.manifest.json` 记录一致就跳过，加 `-Force` 强制重建。

## 已知注意事项

### 本机 `pnpm dist` 报 `Unknown argument: …electron-builder\cli.js`

pnpm 会把脚本体里的 `node` 替换成它自己运行所在的 Node。如果 pnpm 本身跑在 Electron 里（例如桌面端内置的 pnpm），这个替换会指向宿主 exe，于是 `.bin/electron-builder.CMD` 内部的 `node cli.js` 变成了 `宿主.exe cli.js`。

绕开：

```powershell
cd app
.\node_modules\.bin\electron-builder.CMD --win portable
```

在普通 Node 环境下 `pnpm dist` 正常。

### 应用图标

`app/build/icon.ico` 由 `app/scripts/make-icon.ps1` 生成（多尺寸 PNG 容器）。改配色或形状重跑脚本即可，不依赖外部设计源文件。

```powershell
cd app
pwsh -NoProfile -File scripts/make-icon.ps1
```

### 样例配置是脱敏的

`channelConfig.sample.json` 里的渠道名与应用名全部改写过（前缀 `demo_`），只用来演示文件结构。真实配置请自己维护，不要提交。

仓库的 `.gitignore` 已经排除 `*.jks`、`*.keystore`、`*.apk`、`data/`、`channelConfig.json` 与 `APK拖动到此分包.bat`。

### 仓库里没有 exe，要自己构建

`app/release/` 在 `.gitignore` 里，所以 clone 下来的仓库**不含便携版 exe**，必须自己跑一次构建（见「从源码构建」）。产物是 `app/release/渠道分包工具-<版本>.exe`，约 114 MB。

不进版本库的原因：它是构建产物，体积上百 MB，且每次构建的字节内容都不同（时间戳、签名等），入库只会让仓库无限膨胀。

**改完代码要重新构建才有新 exe。** `pnpm build` 只更新 `dist/` 与 `dist-electron/`（开发模式用），打包版仍是上一版 —— 从 `app/release/` 打开的话，看到的还是旧逻辑。

**便携版把数据写在 exe 旁边的 `data/`**。如果你直接从 `app/release/` 运行 exe，配置就会落到 `app/release/data/` —— 那是构建产物目录，容易被重新构建或清理时一并删掉，里面的 `.jks` 副本与明文口令也会跟着没。

建议把 exe **拷到别处再运行**（例如 `D:\工具\渠道分包工具\`），数据就跟着留在那里，跟构建目录彻底分开。

## 第三方组件

| 组件          | 版本                     | 许可证                      |
| ------------- | ------------------------ | --------------------------- |
| Electron      | 44.4.5                   | MIT                         |
| Chromium      | 随 Electron              | BSD-3-Clause 等             |
| Temurin JRE   | 17.0.20.1                | GPLv2 + Classpath Exception |
| apksigner     | 0.9                      | Apache-2.0                  |
| zipalign      | Android SDK build-tools  | Apache-2.0                  |
| Walle         | 1.1.6（第三方构建，见下）              | Apache-2.0                  |

### Walle CLI jar 的来源

仓库根目录的 `walle-cli-all.jar` **不是上游的 release 资产，而是一份第三方构建**。来源如下，请知悉后再使用。

| 项       | 值                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 上游项目 | [Meituan-Dianping/walle](https://github.com/Meituan-Dianping/walle)（Apache-2.0）                                         |
| 本仓库这份 | 585,426 字节，SHA256 `89D0358A512B7AC0586F999B31774C6A4B76A388AC35A34B1F28169FA449368B`                                 |
| 获取自   | [issue #264](https://github.com/Meituan-Dianping/walle/issues/264) 里用户 vclub 贴出的自编译产物：`https://github.com/vclub/vclub.github.io/raw/master/walle-cli-all.jar` |
| 代码对应 | 上游 master 上 PR #259（提交 `be6421b`）之后的代码，manifest 标 `Walle-Version: 1.1.6`                                    |
| 内置依赖 | jcommander 1.48、commons-io 2.5、org.json 20080701、gson 2.8.0                                                            |

**为什么不直接用官方 release 资产**：官方只发布过 `v1.1.6` 的 `walle-cli-all.jar`（584,848 字节，SHA256 `E655C5284EE1FC2916CCCA2ED3217C4BE227A8284FDB9218308C9CF431EF222C`），它缺 PR #259 的签名块 verity padding 处理，会产出装不上的渠道包 —— 见 [issue #290](https://github.com/Meituan-Dianping/walle/issues/290)：

```
INSTALL_PARSE_FAILED_NO_CERTIFICATES ... using APK Signature Scheme v3:
Size of APK Signing Block is not a multiple of 4096: 4127
```

官方 `v1.1.7` 没有发布任何资产（[issue #334](https://github.com/Meituan-Dianping/walle/issues/334) 就是在问这件事），上游的 Gradle 构建也已不可用（wrapper 2.14.1、依赖仓库 jcenter 已停服）。

**风险提示**：这份 jar 来自一个个人 GitHub Pages 仓库，无法对应到确切的上游提交，该链接在 issue 里曾失效过一次。若要换成可复现的构建，可从上游固定提交自行编译 —— `walle-cli`、`payload_writer`、`payload_reader` 三个模块的源码用 `javac --release 8` 编译，再与官方 jar 内的第三方依赖合并成 fat jar 即可，不需要 Gradle。

## 许可证

[MIT](LICENSE)
