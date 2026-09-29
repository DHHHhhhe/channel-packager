# 实施计划：渠道分包工具 GUI 版

## 前置条件

| 项 | 状态 |
|---|---|
| Node `v24.21.0` / npm `11.19.0` | 已就绪 |
| 内置运行时 | JRE 由 `jlink` 从 Temurin JDK 17 产出；`zipalign.exe`/`apksigner.jar` 从 build-tools 37.0.0 复制；walle jar 用工作目录现有 |
| **测试用 APK** | **已就位** —— `示例应用_V1.4.6_20260916_1727.apk`（99.47 MB，3756 个条目，当前未写渠道） |
| 25 个 jks + `channelConfig.sample.json` | 已就绪，可直接作为测试素材 |

## 阶段 0：工程骨架与内置运行时

- [ ] 建 `app/` 目录，`npm init`，安装 `electron`、`electron-builder`。
- [ ] 装前端工具链：`vite`、`@vitejs/plugin-react`、`react`、`react-dom`、`tailwindcss`（v4）、`@tailwindcss/vite`。
- [ ] `npx shadcn@latest init`（基色选 **Neutral**），再 `npx shadcn@latest add button card dialog table badge checkbox select input label separator`，组件源码落到 `renderer/components/ui/`。
- [ ] 写 `app/scripts/prepare-runtime.ps1`：
  - **JRE 自行产出**：下载 Temurin JDK 17（Windows x64 zip，182 MB，带 SHA256 校验）→ 解压 → `jlink` 裁剪 → 删除临时 JDK。**不从本机任何安装复制**（本机 Java 依附 Android Studio 的 jbr，卸载即失效）。
  - 从本机 SDK 复制 `zipalign.exe` 与 `apksigner.jar`；从工作目录复制 `walle-cli-all.jar`。
  - 幂等：目标已存在且体积匹配则跳过。
- [ ] 执行脚本，记录各组件实际体积（预期 JRE 30.8 MB + 其余 2.6 MB）。
- [ ] 加 `.gitignore`（`app/node_modules`、`app/resources/bin`、`app/dist`）。

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

> **`jlink` 模块集已实测确定**：`java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`。不要只信 `jdeps` 的输出 —— crypto 走反射，漏掉 `jdk.crypto.ec` 会在签名时才暴露。`jdk.jartool` 用于提供 `keytool.exe`。

## 阶段 1：运行时解析与环境自检

- [ ] `src/main/runtime.js`：解析 `BIN` 目录（区分开发期与打包后），导出 5 个可执行路径。
- [ ] 实现 `checkRuntime()`，返回每个组件的 `{name, path, exists}`。
- [ ] 启动时调用，缺失项在界面顶部横幅显示。

**验证**：临时重命名 `apksigner.jar`，启动应用应提示缺该组件且不崩溃；恢复后提示消失。

## 阶段 2：配置存储层

- [ ] `src/main/store.js`：读写 `data/jks.json`、`data/template.json`、`data/channels/<id>.json`、`data/keystores/`。
- [ ] `src/main/paths.js`：数据根目录按 `design.md` 解析 —— **`PORTABLE_EXECUTABLE_DIR` 优先**（打包后 exe 真实目录），开发态回退工程目录；不可写则回退 `app.getPath('userData')`。同时 `app.setPath('userData', <dataDir>/.runtime)`，否则 Chromium 缓存会另落一份到 `%APPDATA%`。
- [ ] **jks 副本导入**：新增时复制源文件到 `data/keystores/<id>.jks`，同时算 `sha256` 与 `fileSize` 记录。同 `id` 且 SHA256 相同 → 提示已存在并跳过；同 `id` 但 SHA256 不同 → 改用 `<id>_2`，**不覆盖**。
- [ ] **删除 jks**：一并删除 `keystores/<id>.jks` 与 `channels/<id>.json`。
- [ ] **刷新**：`jks:refreshFromSource` 读 `sourcePath` 算 SHA256 比对，返回「未变化 / 已变化 / 原文件不可访问」；**不自动同步**。
- [ ] 从工作目录现有 `channelConfig.sample.json` 生成模板种子：取 13 条带别名的渠道，**剥掉 `demo_` 前缀**，得到 `{suffix, alias}` 列表。
- [ ] 凭据推导函数：`deriveAlias(name)` → `<basename>`，`derivePassword(name)` → `<basename>@123`。

**验证**

```powershell
# 模板种子应为 13 条，且 suffix 不含 demo_
node -e "const c=require('./channelConfig.sample.json');const t=c.channelInfoList.filter(x=>x.alias).map(x=>({suffix:x.channel.replace(/^demo_/,''),alias:x.alias}));console.log(t.length);console.log(t)"
```

> **`keystoreFile` 是签名唯一路径。** 出包与 keytool 校验都只用 `data/keystores/` 下的副本，`sourcePath` 仅用于显示与刷新 —— 这是 R21 的核心，实现时别把两者混用。

## 阶段 3：凭据校验（keytool）

- [ ] `cred:verify` IPC：用内置 `keytool -list -keystore <data/keystores 下的副本> -storepass <pw>` 校验（**不用 `sourcePath`**）。
- [ ] 解析输出（**GBK 编码**，keytool 中文输出在 UTF-8 下是乱码）取出真实别名。
- [ ] 成功/失败结果回传界面，成功时回填别名。

**验证**：`sample.jks` + `sample@123` 通过；`legacy.jks` + `legacy@123` 失败并给出明确提示。

> 注意：`keytool` 输出为 GBK。要么加 `-J-Dfile.encoding=UTF-8`，要么按 GBK 解码。这是实现时最容易踩的坑之一。

## 阶段 4：UI 与拖拽

- [ ] `renderer/styles.css`：写入 `design.md`「设计系统」的 light/dark 令牌（CSS 变量），Tailwind v4 用 `@theme inline` 映射，shadcn/ui 组件直接消费 —— **不逐处硬编码色值**。
- [ ] 字体栈含中文回退（`"Geist", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`）。Geist 的 Latin 子集自托管（woff2，约 30–50 KB），**不引 CDN** —— 应用须离线可用。
- [ ] 布局骨架对齐参考站实测值：侧边栏 `272px`、顶栏 `48px`（sticky + 底部 1px 边框）、卡片圆角 `14px`。
- [ ] `preload/index.js`：`contextBridge` 暴露白名单 API，含 `webUtils.getPathForFile`。
- [ ] 主界面：拖拽区 / 文件选择框 → 显示所选 APK 路径。
- [ ] jks 列表：新增（含「套用模板」「导入 JSON」两个选项）、编辑、删除（带确认，**删副本**）。列表显示来源路径与 SHA256 前 8 位，并提供「从原文件重新导入」按钮。
- [ ] 渠道列表：增删改查表格，渠道必填、别名选填。
- [ ] 模板编辑页：独立于任何 jks，改它不影响已有副本。
- [ ] 出包页：选 jks → 勾渠道 → 选输出目录（默认 `<APK 同级>\渠道包\`）→ 选签名模式 → 开始。
- [ ] 进度区：阶段提示 + 实时输出行。
- [ ] 密码框旁常驻明文存储提示。

**验证**：手动走查全部验收项中的界面部分；重点验证「改副本不影响模板」与「中文未掉到系统默认字体」。

## 阶段 5：出包流水线

- [ ] `src/main/signer.js`：zipalign → apksigner sign → apksigner verify。
- [ ] `src/main/walle.js`：`batch2 -f`、`batch -c`、`show`。
- [ ] `src/main/pipeline.js`：按 `design.md` 的 7 步编排，含第 3d 步「把重签名结果还原成原包名」。
- [ ] `src/main/logger.js`：每次任务一份日志，UTF-8 落盘，**任务结束后不删除**。
- [ ] 第 6 步用 `walle show` 校验产物渠道号。

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

## 阶段 6：导入导出

- [ ] `channels:import`：读 JSON → **原样复制** `channelInfoList`（渠道名与别名逐字保留，不做前缀替换）。
- [ ] `channels:export`：写 JSON，结构与 `channelConfig.sample.json` 完全一致。
- [ ] 导入时校验 JSON 结构；结构不符给出明确错误而不是静默吞掉。

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

- [ ] `src/main/configpack.js`：导出 zip，含 `manifest.json`（版本 / 导出时间 / 各文件 SHA256）、`jks.json`、`keystores/`、`channels/`、`template.json`。
- [ ] 导入时逐文件校验 SHA256，不匹配即中止并指明是哪个文件。
- [ ] 冲突处理：同 `id` 且 SHA256 相同 → 跳过；同 `id` 但内容不同 → 让用户选「跳过 / 保留两份（自动加后缀）/ 覆盖」，**不静默覆盖**。
- [ ] 导入按钮旁直接写明「配置包含明文密码与私钥」，不能只写在文档里。
- [ ] 导出**不含** `logs/` 与 `.runtime/`。

**验证**：导出 → 在另一个干净目录导入 → jks、渠道、模板全部还原，并可直接出包。

## 阶段 7：打包与便携性验证

- [ ] 配 `electron-builder.yml`，`target: portable`，`extraResources` 带 `bin/`。
- [ ] `src/main/paths.js` 用 `PORTABLE_EXECUTABLE_DIR` 解析 `data/`，并同步 `app.setPath('userData', …)`。
- [ ] 构建，记录最终 exe 体积（预期 ≈ 185 MB，验收线 190 MB 以内）。
- [ ] **便携性验证**：把 exe 拷到一个全新目录运行 → 新增一个 jks、改模板 → **关掉应用重开，确认配置仍在**。这是 portable 目标最容易失败的验证点 —— exe 每次启动都自解压到 `%TEMP%`。
- [ ] **环境隔离验证**：临时清空 `JAVA_HOME` 与 `PATH` 中的 java 项，运行 exe，确认重签名仍可用。
- [ ] **分发验证**：把**仅 exe** 拷到另一目录运行 → 应是干净工具（无 jks、无渠道）；再导入配置包 → 数据完整还原。

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
