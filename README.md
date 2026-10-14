<img src="app/build/icon.png" alt="" width="76">

# 渠道分包工具

**中文** ｜ [English](README.en.md)

[![version](https://img.shields.io/github/v/release/DHHHhhhe/channel-packager)](https://github.com/DHHHhhhe/channel-packager/releases)
![platform](https://img.shields.io/badge/platform-Windows-0078d4)
[![license](https://img.shields.io/github/license/DHHHhhhe/channel-packager)](LICENSE)

把一个 APK 拖进来，勾几个渠道，得到一批写好渠道信息的渠道包。

渠道用美团的 [Walle](https://github.com/Meituan-Dianping/walle) 方案写进 APK 的 V2 签名块，所以**应用侧也要用 Walle 读**才读得到 —— 详见[适用范围](#适用范围产出的是-walle-渠道包)。

不用装 Java，也不用配 Android SDK —— JRE、apksigner、zipalign、walle 全部随包内置，装上就能用。

![主界面](docs/images/main.png)

## 目录

- [它能做什么](#它能做什么)
- [适用范围：产出的是 Walle 渠道包](#适用范围产出的是-walle-渠道包)
- [快速开始](#快速开始)
- [界面](#界面)
- [渠道列表挂在分组上，不挂在签名文件上](#渠道列表挂在分组上不挂在签名文件上)
- [功能细节](#功能细节)
- [数据放在哪](#数据放在哪)
- [配置包](#配置包)
- [从源码构建](#从源码构建)
- [发布新版本](#发布新版本)
- [已知注意事项](#已知注意事项)
- [第三方组件](#第三方组件)
- [许可证](#许可证)

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| 批量出渠道包 | 一个 APK 一次生成一批渠道包，产物名为 `<原包名>_<别名>.apk` |
| 只写渠道、不重新签名 | 手上只有别人签好的包、没有私钥时也能用 |
| 渠道按分组管理 | 一份渠道列表就是一个分组，与签名文件解耦，可并存多份；新增渠道套模板即可 |
| 口令单独保存 | 每个签名文件的口令独立保存，界面里可改，也能点眼睛核对明文 |
| 不依赖本机环境 | JRE、apksigner、zipalign、walle 全部内置，不用装 Java，也不用配 Android SDK |
| 配置可整体迁移 | 导出配置包（可去掉签名凭据），换机器或统一团队配置可一次完成 |
| 出错能定位 | 失败时直接给出卡在哪一步、退出码与那一步输出的末尾，另有完整日志 |
| 自动更新 | 安装后自动检查新版本，先展示更新内容，由使用者决定是否下载 |

## 适用范围：产出的是 Walle 渠道包

**这不是一个「什么包都能用」的通用分包工具。** 本工具调用的是美团的 [Walle](https://github.com/Meituan-Dianping/walle)（瓦力），它把渠道信息写进 APK 的 `APK Signing Block` 区块 —— 那是 **Android Signature V2 Scheme** 签名方案才有的区块。由此有几条硬性前提，用之前先确认：

| 前提 | 说明 |
| --- | --- |
| **原包必须有 V2 签名** | Walle 只认 V2。只有 V1 签名的包写不进去，会直接报 `has no v2 signature in Apk Signing Block`。V2 从 Android 7.0 起才有 |
| **读取方必须用 Walle 的 SDK** | 应用侧要接 `WalleChannelReader`（或 `payload_reader`）才读得到。友盟、`META-INF/channel_xxx` 文件、`packer-ng-plugin` 等**其他方案的代码读不到本工具写的渠道**，反过来也一样 |
| **别用 apksigner 重新签名** | 重新签名会丢掉渠道信息（官方 README 明确写了）。要改签名，就在签名之后**再写一次**渠道 —— 本工具的出包顺序正是这样 |
| **加固要在写渠道之前做** | 360 加固这类工具会改动签名块，先写渠道再加固会让渠道失效，得在加固后重新写 |

换句话说：**它和你的应用侧读取代码必须是同一套方案（Walle）**。选型前先确认团队现在用的是什么 —— 如果应用里读渠道用的是别的方式，本工具产出的包在那个应用里读不出渠道号。

## 快速开始

1. 到 [Releases](https://github.com/DHHHhhhe/channel-packager/releases) 下载 `channel-packager-setup-<版本>.exe` 装上（安装路径可以自己选）
2. 打开应用，到「签名配置」新增签名文件：选 `.jks` 文件，确认别名与口令，点「新增并校验」
3. 到「渠道配置」新建分组并维护它的渠道列表；「模板与配置包」维护后缀表，新增签名文件时可一键套用
4. 到「出包」把 APK 拖进去，勾选要出的渠道，点「开始出包」

> 第一次打开会被 Windows SmartScreen 拦一下（没有代码签名证书，发布者显示为「未知发布者」）。点「更多信息」→「仍要运行」即可，不是文件损坏。

装好的版本会**自动检查更新**：发现新版本时先展示更新内容，由使用者决定是否下载；下载完成后可以立即重启，也可以下次关窗口时自动安装。

> 便携版（`渠道分包工具-<版本>.exe`）与解压即用版不带自动更新，要更新得手动换包。这两种形态仓库里没有，需要自己构建（见[从源码构建](#从源码构建)）。

## 界面

![侧边栏](docs/images/sidebar.png)

左侧四个页面：

| 页面 | 作用 |
| --- | --- |
| 出包 | 选 APK 与渠道，开始分包 |
| 签名配置 | 管理签名文件与密码 |
| 渠道配置 | 维护分组与渠道列表 |
| 模板与配置包 | 后缀模板、导入导出配置 |

导航项右侧的数字是该页的条目数（签名文件数、分组数）；底部是主题切换、检查更新与当前版本。

## 渠道列表挂在分组上，不挂在签名文件上

一个分组 = 一份渠道列表，与有没有私钥无关：

- 一个应用可以挂「正式」「测试」多个分组
- 同一份渠道列表也能给不同的签名文件用
- 选签名文件只是为了签名

手上只有别人签好的包、没有私钥时，签名那一栏选「不用签名文件」即可只写渠道、不重新签名。

## 功能细节

<details>
<summary>展开：各页的具体行为与边界处理</summary>

| 位置 | 操作 | 说明 |
| --- | --- | --- |
| 签名配置 → 新增签名文件 | 口令右侧的眼睛按钮 | 切换口令明文/密文，用来核对手抄错没有 |
| 签名配置 → 新增签名文件 | 「渠道数据」区块 | 选好 `.jks` 文件后才可用；无论选「不套用模板 / 套用模板 / 导入 JSON」，下方始终是**最终会保存的列表**，可以直接增删改、也能勾选多行一次删掉；新增签名文件的同时就把渠道建好。选「导入 JSON」会先弹一个可编辑的预览框，改完点确认才落到这份列表上 |
| 签名配置 → 新增签名文件 | 校验没过时 | 弹窗不关闭，已填内容不会丢失，只标红出问题的那一项（`.jks` 文件 / 别名 / 口令），改动该项后红框立即撤销；「新增并校验」失败会把刚建的条目、副本与渠道文件一起删干净，不会留下半条脏数据 |
| 渠道配置 / 模板与配置包 | 勾选行 → 「删除选中」 | 表头是全选框，支持一次删多条；列表被搜索过滤时，全选只作用于**显示中**的行 |
| 渠道配置 / 模板与配置包 / 新增签名文件 | 列表上方的搜索框与「排序方式」 | 按渠道号或别名过滤（大小写不敏感）；可按渠道号或别名排序，中文按拼音、渠道号里的数字按大小，空别名沉底。**搜索和排序只改显示**，保存与导出写的一直是整份列表；计数会变成「显示 X / 共 N 项」。保存被拦下（例如有空渠道名）时会自动清掉搜索，免得出问题的那一行藏在过滤后面找不到 |
| 渠道配置 | 「导入 JSON」 | 弹出可编辑的预览框：条目就是文件里的内容，能直接增删改；同时选**覆盖**（默认，整表替换）还是**追加**（接到现有列表后面，同名渠道跳过）。确认后只填进页面列表，**不写入文件** —— 与手工输入的效果相同，需要再点「保存渠道列表」才写入磁盘，因此导入不会丢失未保存的修改 |
| 渠道配置 | 「导出 JSON」 | 导出的是**界面上**的列表（含尚未保存的修改），不是磁盘上那份 |
| 渠道配置 | 渠道列表为空时的「导出示例 JSON」 | 给一份可以直接改的起点，条目取自「模板与配置包」页的模板 + 当前前缀；改完用「导入 JSON」读回来 |
| 渠道配置 | 「按模板生成」 | 是整表替换，所以列表里还有没保存的改动时会先弹确认；取消则列表原样不动 |
| 渠道配置 | 「渠道前缀」 | **没有默认值**，按这次要出的渠道自己填。只把前缀记下来，**不会动下面的列表**；点「按模板生成」才按新前缀重算，此时若手改过行会先弹确认 |
| 出包 | 「自定义渠道导出」 | 临时配一份渠道列表直接出包：既能导入一份渠道 JSON，也能直接手写渠道号（一行一个，别名选填）。默认**不写入磁盘**，只有勾选「存入分组」的条目会追加进所选分组 |
| 出包 | 「查看渠道」 | 弹窗显示包里的渠道号；包里没有渠道信息时会明确说明，不会把文件路径当成渠道号 |
| 出包 | 失败时的结果卡片 | 直接写出**卡在哪一步、退出码是多少、那一步输出的末尾 15 行**，无需再查阅日志；旁边的「复制诊断信息」可一键复制完整内容，路径里的家目录会自动换成 `%USERPROFILE%`，可以直接贴给别人 |
| 出包 | 「跳过签名」 | 重签名时会在原包旁边额外保留一份 `<原包名>_已签名_未写渠道.apk`，下次把它拖进来、签名模式选「跳过签名」，就能省掉 zipalign + apksigner 这一步。出包前会先核对这份包的签名证书与所选签名文件是否一致，对不上直接中止 —— 否则会签出一批签名对不上的包，要到安装或覆盖更新时才发现 |
| 出包 | 「不用签名文件」 | 手上只有别人签好的包、没有私钥时选它：只写渠道，不重新签名。选它不需要任何签名文件，出包前会先确认原包**能被跳过**（证书读不出、或没有 v2 签名会直接拦下）；写完后还会逐个核对产物的签名证书与输入包是否一致，对不上就标红 |
| 出包 | 输出目录里的 `.work/` | 每次点「开始出包」会先清空上一轮的 `.work/`，不会无限累积；本次失败时保留，方便对照中间产物排查 |
| 出包 | 子进程卡死 | zipalign / apksigner / walle 超过 **10 分钟没有任何输出**就判定卡住，强制结束并在卡片上写明「卡住后已强制结束」；界面不会一直转下去 |
| 出包 | 结果卡片上的「打开输出目录」/「打开日志」 | 用系统文件资源管理器打开产物目录，日志那一行点一下直接用系统默认程序打开；路径不存在时会明确提示，不会弹出系统报错框 |
| 出包 | 结果卡片上的「重跑本次」 | 把上一次出包用的参数（APK、签名文件、勾选的渠道、签名模式、输出目录）**填回表单**，但不会立即执行 —— 需要换几个渠道再执行一次时，无需重新拖入文件 |
| 出包 | 「加入队列」/「开始队列」 | 可先配置多组（不同 APK、不同签名文件、不同渠道）再统一执行。**串行**执行，一项失败只标记该项、不影响后续项；逐项状态就在队列卡片里，点「详情」查看该项的结果卡片。「加入队列」只是把当前表单的参数记下来，点「开始队列」才真正出包 |
| 模板与配置包 | 导出配置包时勾上「导出时不带签名凭据」 | 导出的包里只有渠道模板与一份空的签名文件列表 —— 没有私钥、没有密码，也没有分组与渠道列表。对方导入后本机的签名文件与分组一条都不会被动到，自己新增签名文件就能套用模板 |
| 数据放在哪 | `data/logs/` | 最多留 30 份、总体积不超过 50 MB，按最旧的删，至少保留最近 10 份 |
| 数据放在哪 | 配置文件损坏时 | 顶部弹出一条横幅，写明**是哪个文件、为什么读不出来、绝对路径**，并把损坏的内容另存一份 `<文件名>.broken`，然后按空列表继续 —— **原文件一个字节都不改**。修好或删掉之后重新打开即可；点「知道了」可以先把横幅收起来（换一个新文件出问题时还会再冒出来） |

</details>

## 数据放在哪

**安装版**的数据目录在 `%LOCALAPPDATA%\渠道分包工具\data`（与安装目录分开，卸载不会连数据一起删）。

**便携版 / 解压即用版**是单文件 exe，每次启动自解压到 `%TEMP%`，但数据目录固定在 exe 旁边：

```
渠道分包工具-<版本>.exe
data/
├── jks.json                # 每个签名文件的别名、口令
├── groups.json             # 分组索引：分组名、中文应用名
├── template.json           # 渠道后缀模板
├── keystores/<id>.jks      # jks 副本，签名与校验只用副本
├── channels/<分组 id>.json # 每个分组的渠道列表
├── logs/                   # 每次出包的完整日志（自动轮转，不会无限涨）
└── .runtime/               # Chromium 缓存，可删
```

整个文件夹拷走就是完整迁移；只拷 exe 就是一份干净的新工具（无证书、无渠道）。

`groups.json` 是渠道文件的索引 —— 它和 `channels/` 必须成对，删了索引那些渠道文件就没人认领了（导入配置包时也按它配对）。旧版本升级上来时，会把原来挂在每个签名文件上的渠道列表自动认成一个同名分组，并把旧的「英文应用名」并进「中文应用名」；这个过程幂等，重复启动不会重复建。

这几个 `.json` 如果损坏（手动编辑漏了括号、磁盘写入过程中断电），启动时会在顶部弹出横幅，写明是哪个文件、为什么读不出来、绝对路径，并把损坏的内容另存一份 `<文件名>.broken`，然后按空列表继续 —— **原文件一个字节都不改**，修好或删掉再重开就行。注意「文件不存在」和「文件坏了」是两回事：前者是正常的「还没配过」，不会报；只有读不出来才算问题。

签名文件在「新增并校验」时会复制一份到 `data/keystores/`，之后签名只用副本 —— 原始 `.jks` 文件移走或删掉都不影响出包。删签名文件**不会**动到任何分组与渠道列表：两者已经解耦了。

> ⚠️ **不要在 `app/release/` 里双击刚构建出来的 exe。** 数据目录跟着 exe 走，会在构建产物目录里当场生成一份 `release/data/`，里面有 jks 副本与明文口令；而 `release/` 重建或清理时会被整个删掉，打包分享时也会被一起带走。把 exe 与 `data/` 一起放到仓库外的目录（例如 `桌面\渠道分包工具\`），从那里双击使用。构建脚本里已有一道保险：检测到 `app/release/data/` 会直接中止构建并提示。

## 配置包

> 配置包内含**明文密码与私钥**。导出后只发给你信任的人；导入等于把对方的签名身份装进本机。

| 方式 | 内容 | 用途 |
| --- | --- | --- |
| 发安装包 | 干净工具，无任何证书与渠道 | 给同事一份工具 |
| 发配置包 | jks 副本 + 凭据 + 分组与渠道列表 + 模板，打成一个 zip | 换机器整体迁移、统一团队配置 |
| 发配置包（勾上「不含签名凭据」） | 只有模板 + 一份空的签名文件列表，打成一个 zip | 给同事一份渠道模板，签名文件让他自己补 |

导入前会校验 manifest 与每个文件的 SHA256，并列出冲突；冲突处理可选**跳过**、**保留两份**（新条目改名为 &lt;id&gt;_2）或**覆盖**。

分组与渠道列表写在包内的 `groups.json` + `channels/` 里。**旧版本导出的包（只有 `channels/`、没有 `groups.json`）仍可导入** —— 会按「每个签名文件一个同名分组」还原，并把包内旧字段里的「英文应用名」并进中文应用名。配置包的格式版本没有变，新旧 exe 互认。

导出一份渠道列表本身用「渠道配置」页的「导出 JSON」/「导出示例 JSON」即可，那两份只含渠道名与别名。

## 从源码构建

### 前置

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20 | 开发用 Node v24 验证 |
| pnpm 11 | `packageManager` 已锁定 11.8.0 |
| PowerShell 7 | 运行时准备脚本与图标生成脚本用 |
| Android SDK build-tools | 可选。只用来取 `zipalign.exe` 与 `apksigner.jar`；本机没装 SDK 就沿用仓库自带的那两份 |
| 网络 | `prepare:runtime` 需从 Adoptium 下载 Temurin JDK 17（约 182 MB） |

### 步骤

```powershell
git clone https://github.com/DHHHhhhe/channel-packager.git
cd channel-packager/app

pnpm install
pnpm prepare:runtime   # 生成 resources/bin —— 未入库，必须执行一次
pnpm dev               # 开发模式
pnpm build             # 类型检查 + 打包渲染层
```

出安装包 / 便携版（产物在 `app/release/`）：

```powershell
.\node_modules\.bin\electron-builder.CMD --win nsis portable zip
```

> 本机不能用 `pnpm dist`，原因见[已知注意事项](#本机-pnpm-dist-报-unknown-argument-electron-builderclijs)。

`app/resources/bin/` 基本不入库（33.4 MB，只有 `zipalign.exe` 与 `apksigner.jar` 约 2.0 MB 随仓库分发），由 `pnpm prepare:runtime` 重建：

| 产物 | 来源 |
| --- | --- |
| `jre/` | 从 Adoptium 下载 Temurin JDK 17，用 `jlink` 裁剪（模块集 `java.base,java.sql,java.logging,jdk.crypto.ec,jdk.jartool`） |
| `zipalign.exe`、`apksigner.jar` | 本机 Android SDK build-tools 里版本号最高的正式版目录；本机没装 SDK 时沿用仓库自带的那两份（已入库，所以没有 SDK 也能构建） |
| `walle-cli-all.jar` | 仓库根目录（第三方构建，来源见[第三方组件](#第三方组件)） |

脚本幂等：产物存在且体积与 `resources/bin/.manifest.json` 记录一致就跳过，加 `-Force` 强制重建。

## 发布新版本

推一个 `v<版本>` 标签，GitHub Actions 会在 Windows 上构建并把**安装包 + `.blockmap` + `latest.yml`** 传到 Releases。本机不用装 Node / Android SDK，也不用配令牌。

```powershell
# 1. 改 app/package.json 的 version（必须比线上大，同号不会被升级）
# 2. 把这一版要说的写进 app/build/release-notes.md —— 它会成为 Release 正文，
#    也是客户端「发现新版本」时显示的更新内容
# 3. 提交推送之后：
git tag v0.3.0
git push origin main --tags
```

跑完 Release 直接是**正式版本**（客户端才认），已装旧版的机器打开应用就会自己升级。想先出草稿、人工点 Publish 再公开：在仓库的 Settings → Secrets and variables → Actions → Variables 里加一个 `EP_DRAFT=true`，或者在 Actions 页面手动触发这个工作流时把 `draft` 勾上。

### 本机发版（不想走 CI）

```powershell
git remote add origin https://github.com/<账号>/<仓库>.git   # 只需一次
$env:GH_TOKEN = 'ghp_xxx'                                   # 公开仓库勾 public_repo，私有仓库勾 repo
pwsh -File app/scripts/release.ps1
```

脚本从 `origin` 读出账号与仓库名（`electron-builder.yml` 里那两个是占位值，构建机器上必须覆盖，否则会直接构建失败），先 `pnpm build`，再用 `electron-builder --win nsis --publish always` 构建并上传。上传完 Release 是**草稿**，要去网页点 Publish，同事那边才看得到。

| 发版方式 | 适合 | 前置 |
| --- | --- | --- |
| GitHub Actions | 换机器发、给协作者发 | 仓库已经推到 GitHub |
| `app/scripts/release.ps1` | 本机就有构建环境，想立刻发 | 装好 Node / pnpm，配好 `GH_TOKEN` |

两种方式都只上传**安装包**（它是唯一带自动更新的产物）；便携版与解压即用版留在本机 `app/release/` 里，要发就手动传。

### 关于更新地址

- 装好的机器把更新地址固化在安装包的 `resources/app-update.yml` 里，**换地址要重新构建安装包**
- 临时换地址不用重新打包：在数据目录放一份 `update.json`（`{"url":"http://内网服务器/渠道分包工具/"}`），应用启动时用它覆盖构建时的地址

## 已知注意事项

### 发给别人时，第一次打开会被 Windows 拦一下

安装包没有代码签名证书，Windows SmartScreen 会弹「Windows 已保护你的电脑」，发布者显示为「未知发布者」。这不是文件损坏，点「更多信息」→「仍要运行」即可。

如果只看到「不运行」和「更多信息」两个按钮，「仍要运行」位于「更多信息」展开后的菜单中。同类提示还有：

| 提示 | 处理 |
| --- | --- |
| 浏览器下载后提示「不常见的下载 / 已阻止不安全的下载」 | 选「保留」 |
| 杀毒软件报「未知发布者」并要求拦截 | 加白名单；这是签名缺失导致的，不是检出病毒 |
| 右键安装包 → 属性，底部有「解除锁定」 | 勾选并确定，可减少一次提示 |

把工具给别人时**只发安装包**，不要连 `data/` 一起发 —— 那里面有 `jks.json` 的**明文口令**、`keystores/` 的私钥副本、分组与渠道列表、以及含本机路径的日志。需要把渠道表给别人参考时，用「渠道配置」页的「导出 JSON」/「导出示例 JSON」，那两份只有渠道名与别名。

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

`channelConfig.sample.json` 里的渠道名全部改写过（前缀 `demo_`），只用来演示文件结构 —— 它只有 `channelInfoList` 一个字段。真实配置请自己维护，不要提交。

导入时只认 `channelInfoList`；文件中若仍包含旧版本写入的 `defaultExtraInfo`，会被**直接忽略**（本工具不再往包里写额外信息，写进去的也只是无人读取的元数据）。

仓库的 `.gitignore` 已经排除 `*.jks`、`*.keystore`、`*.apk`、`data/` 与 `channelConfig.json`。

### 仓库里没有 exe，要自己构建

`app/release/` 在 `.gitignore` 里，所以 clone 下来的仓库**不含任何 exe**，必须自己跑一次构建（见[从源码构建](#从源码构建)）。产物是 `app/release/渠道分包工具-<版本>.exe`，约 120 MB。

不进版本库的原因：它是构建产物，体积上百 MB，且每次构建的字节内容都不同（时间戳、签名等），入库只会让仓库无限膨胀。

**改完代码要重新构建才有新 exe。** `pnpm build` 只更新 `dist/` 与 `dist-electron/`（开发模式用），打包版仍是上一版 —— 从 `app/release/` 打开的话，看到的还是旧逻辑。

## 第三方组件

| 组件 | 版本 | 许可证 |
| --- | --- | --- |
| Electron | 44.4.5 | MIT |
| Chromium | 随 Electron | BSD-3-Clause 等 |
| Temurin JRE | 17.0.20.1 | GPLv2 + Classpath Exception |
| apksigner | 0.9 | Apache-2.0 |
| zipalign | Android SDK build-tools | Apache-2.0 |
| Walle | 1.1.6（第三方构建，见下） | Apache-2.0 |

### Walle CLI jar 的来源

仓库根目录的 `walle-cli-all.jar` **不是上游的 release 资产，而是一份第三方构建**。来源如下，请知悉后再使用。

| 项 | 值 |
| --- | --- |
| 上游项目 | [Meituan-Dianping/walle](https://github.com/Meituan-Dianping/walle)（Apache-2.0） |
| 本仓库这份 | 585,426 字节，SHA256 `89D0358A512B7AC0586F999B31774C6A4B76A388AC35A34B1F28169FA449368B` |
| 获取自 | [issue #264](https://github.com/Meituan-Dianping/walle/issues/264) 里用户 vclub 贴出的自编译产物：`https://github.com/vclub/vclub.github.io/raw/master/walle-cli-all.jar` |
| 代码对应 | 上游 master 上 PR #259（提交 `be6421b`）之后的代码，manifest 标 `Walle-Version: 1.1.6` |
| 内置依赖 | jcommander 1.48、commons-io 2.5、org.json 20080701、gson 2.8.0 |

**为什么不直接用官方 release 资产**：官方只发布过 `v1.1.6` 的 `walle-cli-all.jar`（584,848 字节，SHA256 `E655C5284EE1FC2916CCCA2ED3217C4BE227A8284FDB9218308C9CF431EF222C`），它缺 PR #259 的签名块 verity padding 处理，会产出装不上的渠道包 —— 见 [issue #290](https://github.com/Meituan-Dianping/walle/issues/290)：

```
INSTALL_PARSE_FAILED_NO_CERTIFICATES ... using APK Signature Scheme v3:
Size of APK Signing Block is not a multiple of 4096: 4127
```

官方 `v1.1.7` 没有发布任何资产（[issue #334](https://github.com/Meituan-Dianping/walle/issues/334) 就是在问这件事），上游的 Gradle 构建也已不可用（wrapper 2.14.1、依赖仓库 jcenter 已停服）。

**风险提示**：这份 jar 来自一个个人 GitHub Pages 仓库，无法对应到确切的上游提交，该链接在 issue 里曾失效过一次。若要换成可复现的构建，可从上游固定提交自行编译 —— `walle-cli`、`payload_writer`、`payload_reader` 三个模块的源码用 `javac --release 8` 编译，再与官方 jar 内的第三方依赖合并成 fat jar 即可，不需要 Gradle。

## 许可证

[MIT](LICENSE)
