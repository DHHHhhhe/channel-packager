# 渠道分包工具 GUI 版

## Goal

把现有 `APK拖动到此分包.bat` 的渠道分包能力做成带 GUI 的免安装桌面应用。用户价值有三点：

1. **一个 jks 对应一套自己的签名凭据与渠道信息**，两者都可自主增删。现有 bat 把签名凭据硬编码成单一 `demo`，而实际目录里有 25 个 jks、密码各不相同 —— 换任意一个 jks 都会失败。
2. **操作路径缩短为一条主线**：拖入或选择 APK → 选 jks → 勾渠道 → 出包。不再走 bat 的多级 `choice` 菜单。
3. **应用数据自包含**：jks 以副本形式收进应用数据目录，原文件被移动或删除都不影响使用（R21）。

## Background

### 现有 bat 的逻辑

`APK拖动到此分包.bat`（GBK，316 行）：

| 环节 | 现有实现 |
|---|---|
| 入口 | 拖拽 APK 到 bat，取 `%~1`；校验存在 + `.apk` 后缀 |
| 配置 | `channelConfig.sample.json`：`defaultExtraInfo.app` + `channelInfoList[].channel/.alias` |
| 主菜单 | 1 重签名后写渠道 / 2 跳过签名直接写 / 3 查看 APK 现有渠道 / 0 退出 |
| 渠道方式 | 1 按配置文件（可选单条或全部）/ 2 手输逗号分隔渠道名 |
| 重签名 | `zipalign -f -v 4` → `apksigner sign --v2-signing-enabled true` → `apksigner verify -v` |
| 写渠道 | `java -jar walle-cli-all.jar batch2 -f <cfg> <apk> <out>` 或 `batch -c <ch1,ch2> <apk> <out>` |
| 查渠道 | `java -jar walle-cli-all.jar show <apk>` |
| 输出目录 | `<APK 同级目录>\渠道包\` |
| 产物重命名 | 正则去掉 `_jiagu_<xxx>` 段、去掉 `resigned`、合并重复 `_`/`-` |
| 本次清单 | 记 `Get-Date -Format o` 为起点，只列 `LastWriteTime >= 起点` 的 apk |
| 临时目录 | `<APK 同级>\.channel_work`，成功结束时 `rd /s /q` 删除 |
| 重签名主包 | 复制到 APK 同级，`_jiagu_<xxx>` → `_jiagu_resigned`，否则追加 `_resigned` |

### bat 的缺陷（均已定位到具体代码）

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| B1 | 签名凭据硬编码 `KEY_ALIAS=demo` / `STORE_PASSWORD=demo@123`，jks 用 `for %%f in ("!PROJECT_DIR!\*.jks") do set "KEYSTORE_PATH=%%f"` 取循环最后一个 | `:prepare_sign_tools` | **致命**。25 个 jks 中 24 个密码不同，换 jks 必然失败，且用哪个 jks 不可控 |
| B2 | `set "SDK_DIR=%LOCALAPPDATA%\Android\Sdk` 引号未闭合 | `:prepare_sign_tools` | 变量解析依赖 cmd 容错，语法炸弹 |
| B3 | `java` 依赖 PATH 与 `JAVA_HOME` | 全文 | 目标机器没装 Android Studio 就完全不可用 |
| B4 | 临时目录固定 `.channel_work` | `:prepare_dirs` | 两个实例并发处理同一目录会互相覆盖 |
| B5 | 结束即 `rd /s /q "!WORK_DIR!"` | `:success` | 失败日志被删，事后无法复盘 |
| B6 | 无渠道名合法性校验 | `:read_channel_list` | 手输错误渠道名要等 walle 执行完才报错 |
| B7 | 无进度反馈 | `:batch_from_config` | walle 输出整体重定向到文件，大包期间界面静止 |
| B8 | `channelConfig.sample.json` 只有一套渠道 | 配置层 | 无法按 jks/马甲分包维护渠道 |
| B9 | 输出目录固定为 APK 同级 | `:prepare_dirs` | 不能指定输出位置 |
| B10 | 单 APK、串行 | 入口 | 一次只能处理一个 APK |

### 实测环境事实

- 目录下 **25 个 `.jks`**，全部 PKCS12（文件头 `30 82`）。
- **密码规律 `<jks 文件名>@123`、别名 = `<jks 文件名>`，25 个命中 24 个。**
  - 例：`sample.jks` → storepass `sample@123`，alias `sample`。
  - 与 bat 硬编码的 `demo`/`demo@123` 同构 —— bat 只针对 `demo` 这一个包写死。
- **唯一例外 `legacy.jks`**：文件有效（PKCS12，2500 字节），密码不符规律，`legacy@123`/`legacy123`/`legacy`/`123456` 等 10 个候选均失败。
- PKCS12 的 store 密码与 key 密码强制相同，`apksigner` 只需一个密码。
- 本机 `JAVA_HOME` = `%LOCALAPPDATA%\Programs\Android Studio\jbr`；SDK build-tools 有 `30.0.3`/`36.1.0`/`37.0.0`（bat 取最新 = `37.0.0`）。
- 可用运行时：Node `v24.21.0`、npm `11.19.0`、Python `3.12.10`；**无 dotnet**。
- 工作区不是 git 仓库。
- `channelConfig.sample.json` 现有 23 条渠道，`defaultExtraInfo.app = "demo"`，带别名的 13 条渠道名均带 `demo_` 前缀。

### 技术要点：walle 输出命名与 bat 改名

**实际使用的命名规则**（用户确认）：

| | 文件名 |
|---|---|
| 原包名 | `示例应用_V1.4.6_20260916_1727.apk` |
| 渠道包名 | `示例应用_V1.4.6_20260916_1727_应用宝.apk` |

即 **`<原包名>_<别名>.apk`；别名非必填，无别名时为 `<原包名>_<渠道>.apk`**。

反汇编 `walle-cli-all.jar` 的 `Batch2Command.generateChannelApk` 确认这正是 walle 的原生行为：

```
输出文件名 = FilenameUtils.getBaseName(输入APK) + "_" + (alias 非空 ? alias : channel) + "." + 扩展名
```

**因此渠道包不需要任何改名后处理。** bat 里那段正则的实际作用域：

| bat 正则 | 对当前包名是否生效 | 说明 |
|---|---|---|
| `^(.*)_[^_]+_jiagu_[^_]+_(.+\.apk)$` → `$1_$2` | **否，空操作** | 只对加固包命名 `xxx_jiagu_xxx.apk` 生效。实测 `示例应用_V1.4.6_20260916_1727_应用宝.apk` 输入=输出 |
| `[-_]?resigned(?=…)` 清理 | **是，且必要** | bat 先产出 `<原包名>_resigned.apk` 再对它跑 walle，产物会带 `_resigned` |

**本应用的更优做法**：在临时工作目录里用**原包名**跑 walle，产物名天然干净，无需事后正则改名；重签名主包另存为 `<原包名>_resigned.apk` 供后续使用。这一步同时消掉 B1 之外的改名脆弱点。

### 端到端实测（已用真实 APK 跑通）

用 `示例应用_V1.4.6_20260916_1727.apk`（99.47 MB，3756 个条目）+ `sample.jks` 跑完整流水线，每步退出码均为 0：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 对齐 | `zipalign -f 4` | exit 0 |
| 重签名 | `apksigner sign --ks sample.jks --v2-signing-enabled true` | exit 0 |
| 验签 | `apksigner verify -v` | v1 / v2 / v3 全 `true` |
| 写渠道 | `walle batch2 -f <per-jks 配置>` | exit 0 |

**产物名与设计完全一致**：

| 配置的渠道 | 别名 | 产物 |
|---|---|---|
| `sample_jl_flow` | 巨量 | `示例应用_V1.4.6_20260916_1727_巨量.apk` |
| `sample_ks_flow` | 快手 | `示例应用_V1.4.6_20260916_1727_快手.apk` |
| `CPS00001` | （无） | `示例应用_V1.4.6_20260916_1727_CPS00001.apk` |

**读回校验**：`walle show -c` 逐个读出的渠道号与配置一致；`walle show -e` 读出 `{app=sample}`，证明 per-jks 的 `defaultExtraInfo.app` 确实生效；产物 `apksigner verify` 通过。

这次实测把设计里最关键的两个假设 ——「用原包名跑 walle 产物名干净」与「per-jks 配置能正确写入渠道号与 extraInfo」—— 从推断变成了已验证事实。

### 内置运行时依赖清单（全部实测）

目标机器没有 Android SDK 与 java，因此全部内置。**构建期同样不依赖任何本机安装** —— 本机的 Java 完全依附 Android Studio 的 jbr（`Program Files\Java`、Adoptium、Microsoft JDK、SDK 自带 jdk/jre 均不存在），而 Android Studio 带 `uninstall.exe`，卸载后即复制不出 JRE：

| 组件 | 来源 | 体积 | 备注 |
|---|---|---|---|
| JRE | 构建时下载 Temurin JDK 17，用 `jlink` 裁剪 | **30.8 MB** | 模块集 `java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`；含 `java.exe` / `keytool.exe`。**已实测**：apksigner `version`→`0.9`、真实 `sign`（v2）退出码 0、`verify` v2 通过、walle `-v`→`1.1.6`、keytool 可读 `sample.jks` |
| `zipalign.exe` | `build-tools\37.0.0` | 0.9 MB | Windows 原生可执行，不依赖 java |
| `apksigner.jar` | `build-tools\37.0.0\lib` | 1.1 MB | 可脱离 `apksigner.bat` 与整个 SDK 独立调用 |
| `walle-cli-all.jar` | 工作目录现有 | 0.6 MB | 现成可用 |

内置合计 **≈ 33.4 MB**；Electron 产物 ≈ 150 MB；**最终 exe 预计 ≈ 185 MB**。

对比最初方案（直接复制 Android Studio 的 jbr，92.2 MB）：**体积省 61.4 MB，且不再依赖构建机装过 Android Studio**。

> 模块集由 `jdeps --print-module-deps` 算出（walle 要 `java.base,java.sql`；apksigner 要 `java.base,java.logging`），但 **crypto 相关模块走反射、`jdeps` 看不到**，因此 `jdk.crypto.ec` 是实测补上的，并以真实签名验证。

## Requirements

### 数据模型

- **R1** 每个 jks 独立维护：签名凭据（别名 / 密码）、app 标识、自己的渠道列表。jks 与渠道条目均可自主增删，删除前需确认。
- **R21 jks 文件副本**：新增 jks 时把文件**复制**到应用数据目录（`data/keystores/<id>.jks`），应用后续**只用这份副本**，不依赖原文件路径 —— 原 jks 被移动或删除都不影响使用。应用数据目录由此自包含，可整体拷贝迁移。
  - 同时记录**来源路径 + SHA256**，仅用于界面显示与「从原文件重新导入」按钮；该按钮比对 SHA256 并提示原文件是否已变化，**不自动同步**。
  - 同名但内容不同（SHA256 不一致）时自动加后缀（如 `sample_2`），**不覆盖**已有副本。
  - 删除 jks 时一并删除其副本。
- **R2 渠道模板** —— 「固定模板 + 可编辑副本」：
  - 维护一套**固定模板**，内容为「渠道后缀 + 别名」对（如 `jl_flow`/巨量、`ks_flow`/快手、`gf`/官方、`hw`/华为……）。
  - 新增 jks 时**可选择是否套用模板**；不勾选则从空列表开始。
  - 勾选套用时，**前缀默认取新增 jks 的文件名**且**允许修改**，生成 `<前缀>_<后缀>` 形式的渠道列表作为该 jks 的**副本**。
  - 副本可独立增删改查；**对副本的任何修改都不影响固定模板**（副本与模板彻底解耦，非引用关系）。
  - 无前缀的通用渠道（如 `CPS00001`）作为普通条目直接录入。
- **R3 渠道字段**：新增渠道时「渠道」必填、「别名」选填；别名为空时渠道包名回退用渠道号。与 `channelConfig.sample.json` 的 `{channel, alias?}` 一致。
- **R4 模板种子**：固定模板初始内容取自现有 `channelConfig.sample.json` 中 13 条带别名的渠道，**剥掉 `demo_` 前缀**保留后缀与别名（`jl_flow`/巨量、`ks_flow`/快手、`gf`/官方、`hw`/华为、`xm`/小米、`oppo`/OPPO、`vivo`/VIVO、`honor`/荣耀、`mz`/魅族、`bd`/百度、`yyb`/应用宝、`uc`/UC、`tx_flow`/腾讯）。
- **R5 app 标识**：每个 jks 一个 `defaultExtraInfo.app` 字段，新建时默认取 jks 文件名，可编辑；导入时随文件原样带入。

### 主流程

- **R6** 支持**拖入 APK**或**文件选择框**选 APK，然后选择 jks，勾选该 jks 下的渠道，出包。
- **R7 一次操作范围**：一个 APK + 一个 jks；任务模型预留多 jks 扩展位。
- **R8 重签名**：`zipalign -f 4` → `apksigner sign --v2-signing-enabled true` → `apksigner verify -v`，任一步失败即中止并保留日志。临时工作目录里用原包名跑 walle，重签名主包另存为 `<原包名>_resigned.apk`。
- **R9 跳过签名**：保留该模式，用于 APK 已用目标 jks 签过名的场景；默认仍走重签名。
- **R10 写渠道**：`batch2 -f <cfg> <apk> <out>`（按该 jks 的渠道列表生成临时配置）或 `batch -c <ch1,ch2> <apk> <out>`。
- **R11 查看渠道**：保留 `walle-cli show <apk>`，用于出包后核对。
- **R12 输出目录**：默认沿用 bat 行为 `<APK 同级目录>\渠道包\`，界面允许修改。
- **R13 渠道包命名**：`<原包名>_<别名>.apk`（无别名用渠道号）。即 walle 原生输出，**不做任何改名后处理**。

### 数据交换

- **R14 导入**：新增 jks 时可选**导入 JSON 文件**识别渠道号，格式与 `channelConfig.sample.json` 完全一致。导入为**原样复制**：渠道名与别名逐字保留，**不做任何前缀替换**。
- **R15 导出**：每个已保存的 jks 可导出其渠道数据，格式与 `channelConfig.sample.json` 完全一致，可直接被现有 bat 的 `batch2 -f` 消费。

### 运行时与可靠性

- **R16 内置运行时**：JRE + `zipalign.exe` + `apksigner.jar` + `walle-cli-all.jar` 全部随应用分发，**不依赖系统 PATH、`JAVA_HOME`、Android SDK**。
- **R17 环境自检**：启动时校验内置组件完整性，缺失即明确提示缺哪个，而非执行到一半报错。
- **R18 失败可复盘**：日志落盘且不被清理；每个 jks 的临时工作目录独立，避免并发覆盖。
- **R19 进度反馈**：出包过程有进度与实时输出，不出现长时间静止界面。
- **R20 密码存储**：明文存本地 JSON，界面标注提示。

### 界面与分发

- **R22 UI 风格**：视觉对齐 `https://studio-admin.arhamkhnz.com/dashboard/default`（shadcn/ui，Neutral 基色，Geist 字体）。设计令牌已从该站**实测提取**（色值 / 圆角 / 尺寸 / 排版层级），记录在 `design.md` 的「设计系统」章节 —— 不靠截图估算色值。
- **R23 中文回退**：Geist **不含中文字形**，而界面是中文，必须配置中文回退字体栈，否则中文会掉到浏览器默认字体，与参考站观感脱节。
- **R24 便携数据目录**：`data/` 落在 **exe 真实所在目录**。便携版必须用 electron-builder 注入的 `PORTABLE_EXECUTABLE_DIR` —— exe 每次启动自解压到 `%TEMP%`，若沿用 `path.dirname(app.getPath('exe'))` 会把数据写进临时目录，对方加完 jks 关掉应用就全丢。同时 `app.setPath('userData', …)` 指向同一处，否则 Chromium 缓存仍会另落一份到 `%APPDATA%`。
- **R25 配置包导入导出**：可把 jks 副本 + 渠道 + 模板导出成一个 zip 配置包，对方一键导入。**发单个 exe = 干净工具**（对方自己加 jks）；要连配置一起给就另发配置包 —— 避免随手转发 exe 时连带泄露私钥与密码。

## Key Decisions

| # | 决策项 | 结论 |
|---|---|---|
| K1 | jks 与渠道的绑定 | 固定模板 + 可编辑副本；前缀默认取 jks 文件名、可改；改副本不影响模板 |
| K2 | 技术栈与交付 | Electron，打包为免安装 exe |
| K3 | 导入时的前缀处理 | 原样导入，不做任何前缀替换 |
| K4 | 密码存储 | 明文存本地 JSON + 界面提示。理由：jks 本就在同一目录；DPAPI 加密会破坏免安装 exe 的便携性 |
| K5 | 渠道包命名 | `<原包名>_<别名>.apk`，不做改名后处理 |
| K6 | 渠道字段 | 渠道必填、别名选填 |
| K7 | 功能范围 | 保留「跳过签名」与「查看渠道」 |
| K8 | 一次出包范围 | 一个 APK + 一个 jks |
| K9 | 运行时依赖 | 全部内置（`jlink` 裁剪的 JRE 30.8 MB + zipalign + apksigner + walle jar）。**构建期不依赖任何本机安装**，exe ≈ 185 MB |
| K10 | 数据交换格式 | 沿用 `channelConfig.sample.json` 结构，不引入新格式 |
| K11 | 输出目录 | 默认 `<APK 同级>\渠道包\`，界面可改 |
| K12 | jks 文件存储 | 新增时**复制到 `data/keystores/`**，副本为唯一权威；另记来源路径 + SHA256 供显示与手动刷新，**不自动同步** |
| K13 | 渲染层技术栈 | **React + Vite + Tailwind v4 + shadcn/ui** —— 与参考站同一套组件库，Dialog/Select/Checkbox/Table/Badge/Toast 直接复用，手写交互代码最少 |
| K14 | 便携数据目录 | `PORTABLE_EXECUTABLE_DIR`（exe 真实目录）优先，开发态回退项目目录；并同步 `app.setPath('userData')` |
| K15 | 分发形态 | 单文件 portable exe + 可选 zip 配置包。发 exe = 干净工具；发配置包 = 连 jks 与渠道一起给 |

## Acceptance Criteria

- [ ] 拖入一个 APK 并选中 `sample.jks`，自动带出 alias `sample` / 密码 `sample@123`，无需手输即可完成重签名。
- [ ] 选中 `legacy.jks` 且密码未手工录入时，给出明确提示而不是签名失败到中途。
- [ ] 能新增一个 jks（含别名/密码）并维护其独立渠道列表；能删除 jks 与渠道条目，删除前有确认。
- [ ] 新增 jks 后，把原 jks 文件移走或删除，应用仍能正常出包（证明用的是 `data/keystores/` 里的副本）。
- [ ] 用相同文件名但不同内容的 jks 再次新增，得到 `sample_2` 而不是覆盖 `sample`。
- [ ] 把原 jks 换掉后点「从原文件重新导入」，应用比对 SHA256 并提示原文件已变化。
- [ ] 删除 jks 后，`data/keystores/` 下对应的副本文件也被删除。
- [ ] 打包成 portable exe 后放到新目录运行，新增一个 jks，关闭再打开，jks 仍在（证明 `data/` 落在 exe 同级而非 `%TEMP%`）。
- [ ] 导出配置包 → 在另一个干净目录（或另一台机器）导入 → jks、渠道、模板全部还原，可直接出包。
- [ ] 界面为中文，中文未掉到系统默认字体（字体栈含中文回退）。
- [ ] 新增 jks 时勾选「套用模板」，前缀输入框默认等于该 jks 文件名且可修改；生成副本后增删改副本条目，**固定模板内容保持不变**。
- [ ] 新增 jks 时不勾选模板，得到空渠道列表，可逐条手工添加。
- [ ] 导入一份 `channelConfig.sample.json` 作为新 jks 的渠道数据，导入后的条目数、渠道名、别名与源文件逐字一致。
- [ ] 导出某 jks 的渠道数据，产出的 JSON（`defaultExtraInfo` + `channelInfoList`）能被现有 bat 的 `batch2 -f` 直接消费。
- [ ] 对 `示例应用_V1.4.6_20260916_1727.apk` 出「应用宝」渠道包，产物名为 `示例应用_V1.4.6_20260916_1727_应用宝.apk`。
- [ ] 用 `walle-cli show` 读生成的渠道包，读到的渠道名与所选渠道一致。
- [ ] 在**未安装 java 与 Android SDK** 的机器上（或临时清空 `JAVA_HOME`/`PATH` 后）启动，仍能完成重签名与出包。
- [ ] 在**未安装 Android Studio** 的机器上执行构建脚本，能产出完整 exe（不读取 `jbr`，不依赖任何本机 Java）。
- [ ] 最终 exe 体积在 190 MB 以内。
- [ ] 内置组件缺失时，启动即提示缺哪个，而不是执行到一半报错。
- [ ] 处理失败后日志文件仍在，可看到 walle 或 apksigner 的原始输出。

## Out of Scope

- APK 二次加固（bat 只处理已加固包，不自己做加固）。
- 渠道数据回传统计、云端账号体系。
- 多 APK × 多 jks 的笛卡尔积批量出包。
- 签名密码的加密存储与跨机同步。
- 自动下载/更新 Android SDK 组件。

## Open Questions

- `legacy.jks` 的密码值 —— 属**数据录入项**，由用户在新增/编辑 jks 时手工填写，不阻塞设计与实现。

## Notes

- 现有 `channelConfig.sample.json` 的 `defaultExtraInfo.app` 是 walle 的额外信息写入位（可用 `walle show -e` 读出），与渠道名前缀 `demo_` 同源，说明 app 维度真实存在。
- 工作目录现有 25 个 jks 与 `walle-cli-all.jar` 可直接复用为开发期测试素材。
