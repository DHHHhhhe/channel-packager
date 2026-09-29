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
| 出错排查   | 黑窗口滚过的输出      | 每次出包一份完整日志                          |

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
| `walle-cli-all.jar`                 | 仓库根目录                                                                   |

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

## 第三方组件

| 组件          | 版本                     | 许可证                      |
| ------------- | ------------------------ | --------------------------- |
| Electron      | 44.4.5                   | MIT                         |
| Chromium      | 随 Electron              | BSD-3-Clause 等             |
| Temurin JRE   | 17.0.20.1                | GPLv2 + Classpath Exception |
| apksigner     | 0.9                      | Apache-2.0                  |
| zipalign      | Android SDK build-tools  | Apache-2.0                  |
| Walle         | 1.1.6                    | Apache-2.0                  |

## 许可证

[MIT](LICENSE)
