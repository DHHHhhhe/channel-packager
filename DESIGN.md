---
version: "1.0"
name: 中性单色桌面界面
description: >-
  一套中性单色的桌面工具界面规范。冷银画布 + 纯白卡片，层次由嵌套结构与温度差建立，
  不依赖边框和重阴影。适用于需要长时间盯着看、内容密度偏高的工具类界面。
platform: 桌面端（Electron / Tauri / 浏览器），实现无关
license: 可自由复制、修改、分发

colors:
  light:
    # 画布：带一点蓝的浅灰。不是纯白 —— 纯白画布会让卡片无处附着
    background: "#f2f2f4"
    # 正文与标题：近黑，不用纯黑（纯黑在浅灰上显得生硬）
    foreground: "#0a0a0b"
    # 卡片内芯：纯白。与画布形成温度差，这是层次的主要来源
    card: "#ffffff"
    # 浮层（对话框、下拉、浮出通知）：纯白
    popover: "#ffffff"
    # 主操作：墨色底 + 近白字
    primary: "#0a0a0b"
    primary-foreground: "#fafafa"
    # 次级面：比画布略深的浅灰，用于表头、内嵌区、hover 底色
    secondary: "#f4f4f6"
    muted: "#f4f4f6"
    # 次要文字：中性灰。对 #ffffff 约 5.3:1，过 AA
    muted-foreground: "#6b6b73"
    # 危险 / 成功 / 提醒 / 信息：功能色，不是品牌色
    destructive: "#b3261e"
    success: "#2f6b3f"
    warning: "#8a5a00"
    info: "#1a5fb4"
    # 边框：hairline。6% 的黑在浅灰底上刚好看得见一条线
    border: "oklch(0 0 0 / 6%)"
    input: "oklch(0 0 0 / 8%)"
    # 焦点环：近黑。与主色同源，不在单色界面里突然冒出彩色
    ring: "#0a0a0b"
    # 侧栏：比画布深一档，让导航区与内容区分开
    sidebar: "#f7f7f9"
    sidebar-accent: "#ebebef"

  dark:
    background: "#0c0c0e"
    foreground: "#fafafa"
    # 深色下卡片比画布「亮」一档 —— 深色里阴影几乎不起作用，明度才是深度线索
    card: "#161618"
    popover: "#1c1c1f"
    primary: "#fafafa"
    primary-foreground: "#0a0a0b"
    secondary: "#1f1f22"
    muted: "#1f1f22"
    # 深底上的次要文字取更亮的一档，否则过不了 4.5:1
    muted-foreground: "#8b8b93"
    destructive: "#e5766f"
    success: "#7fbf92"
    warning: "#d9a441"
    info: "#7aa7e0"
    border: "oklch(1 0 0 / 8%)"
    input: "oklch(1 0 0 / 12%)"
    ring: "#fafafa"
    sidebar: "#161618"
    sidebar-accent: "#24242a"

typography:
  font-sans:
    stack: "'Geist Variable', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', system-ui, sans-serif"
    note: 必须显式带中文回退，否则中文会掉到系统默认字体
  scale:
    xs: { size: "12px", lineHeight: "1.5", weight: "400" }
    sm: { size: "14px", lineHeight: "1.5", weight: "400", note: 正文与控件默认字号 }
    base: { size: "16px", lineHeight: "1.6", weight: "400", note: 仅用于页面主标题 }
  weight:
    normal: 400
    medium: 500
    semibold: 600
    note: 只用这三档。不要用 700 —— 中文粗体在小字号下发糊
  numeric:
    tabular: true
    note: 表格里的数字、计数、版本号一律加 tabular-nums，避免逐行跳动

rounded:
  sm: "6px"
  md: "10px"
  # 20px = 1.25rem，对应 CSS 里的 --radius；rounded-lg 消费它
  lg: "20px"
  xl: "28px"
  note: >-
    --radius 基准是 20px（CSS 里写 1.25rem），rounded-lg 消费它。
    嵌套容器必须遵守内圆角 = 外圆角 − 内边距，两条弧才同心。

spacing:
  unit: "4px"
  scale: ["4px", "8px", "12px", "16px", "20px", "24px", "32px", "40px"]
  note: 只用 4 的倍数。卡片内边距 16–24px，区块间距 16–20px，页面边距 24–32px。

shadows:
  card: "0 1px 2px oklch(0 0 0 / 3%), 0 8px 24px -8px oklch(0 0 0 / 6%)"
  float: "0 1px 2px oklch(0 0 0 / 4%), 0 8px 24px -4px oklch(0 0 0 / 6%), 0 24px 48px -12px oklch(0 0 0 / 5%)"
  note: >-
    极柔扩散，每层都很淡。卡片贴面用 card，浮层用 float。
    不要用 Tailwind 的 shadow-* 工具类 —— 见正文第 4 节。

layout:
  sidebar-width: "272px（可拖动，200–420px）"
  sidebar-width-storage-key: "sidebar-width"
  topbar-height: "48px"
  min-window: "1024×680"
  content-max-width: "无硬上限，内容列吸收剩余宽度"

motion:
  micro: "150ms"
  base: "200ms"
  note: 只做状态反馈（hover / 按下 / 展开），不做装饰性动画。尊重 prefers-reduced-motion。

components:
  button-primary:
    backgroundColor: "{colors.light.primary}"
    textColor: "{colors.light.primary-foreground}"
    height: "36px"
    padding: "0 12px"
    radius: "{rounded.lg}"
    note: 每屏只出现一个主按钮
  button-outline:
    backgroundColor: "{colors.light.background}"
    borderColor: "{colors.light.border}"
    textColor: "{colors.light.foreground}"
    height: "36px"
    radius: "{rounded.lg}"
  button-ghost:
    backgroundColor: "transparent"
    hoverBackgroundColor: "{colors.light.muted}"
    height: "36px"
  button-destructive:
    backgroundColor: "{colors.light.destructive} 10%"
    textColor: "{colors.light.destructive}"
    height: "36px"
    note: 危险操作与主操作视觉上必须分开
  input:
    backgroundColor: "{colors.light.background}"
    borderColor: "{colors.light.input}"
    height: "36px"
    radius: "{rounded.lg}"
    focusRing: "{colors.light.ring}"
  card:
    shellBackgroundColor: "rgba(0,0,0,0.025)"
    shellPadding: "6px"
    shellRadius: "{rounded.xl}"
    coreBackgroundColor: "{colors.light.card}"
    coreRadius: "calc(28px - 6px) = 22px"
    shadow: "{shadows.card}"
  badge:
    radius: "full"
    fontSize: "12px"
    note: 只用于状态与计数，不做装饰
  dialog:
    backgroundColor: "{colors.light.popover}"
    radius: "28px"
    shadow: "{shadows.float}"
    maxHeight: "85vh"
  table-header:
    backgroundColor: "{colors.light.muted}"
    fontSize: "12px"
    textColor: "{colors.light.muted-foreground}"
---

# 中性单色桌面界面规范

这是一份**自包含**的界面规范，可以直接复制给任何人或任何 AI 使用。它不依赖任何特定的
代码库、构建工具或框架 —— 第 11 节有一份完整的 CSS，复制进项目就能用。

上面 YAML 里的令牌是**规范性**的：需要精确取用时读它。下面的正文是**语境**：解释这些值为什么
长这样、什么情况下可以偏离。

适用场景：需要长时间盯着看、内容密度偏高的桌面工具。不适合营销页、品牌页、内容型站点 ——
那些需要更强的视觉表达，这份规范刻意把表达欲压到了很低。

---

## 1. 配色：语义命名，每个颜色都有角色

**不要按 hex 挑颜色，按角色挑。** 一个 `#0a0a0b` 既可能是画布也可能是按钮底，
光看色值分不出来。所以每个令牌名都写明它管什么：

| 令牌 | 管什么 | 浅色 | 深色 |
| --- | --- | --- | --- |
| `background` | 画布（页面底） | `#f2f2f4` | `#0c0c0e` |
| `card` | 卡片内芯、输入框底 | `#ffffff` | `#161618` |
| `popover` | 对话框、下拉、浮层 | `#ffffff` | `#1c1c1f` |
| `foreground` | 正文与标题 | `#0a0a0b` | `#fafafa` |
| `muted-foreground` | 次要文字、标签、表头 | `#6b6b73` | `#8b8b93` |
| `muted` | 表头底、内嵌区、hover 底 | `#f4f4f6` | `#1f1f22` |
| `border` | 所有分隔线 | `oklch(0 0 0 / 6%)` | `oklch(1 0 0 / 8%)` |
| `ring` | 焦点环 | `#0a0a0b` | `#fafafa` |
| `primary` | 主按钮底 | `#0a0a0b` | `#fafafa` |
| `destructive` / `success` / `warning` / `info` | 语义状态 | 见 YAML | 见 YAML |

### 三条硬规则

1. **画布不是纯白。** 画布 `#f2f2f4`、卡片 `#ffffff` —— 这个温度差是层次的主要来源。
   两个都用纯白的话，卡片只能靠边框分界，整个界面会显得平。
2. **语义色与品牌色分开。** 主按钮是墨色，不是彩色。`success` / `warning` / `info`
   只在真正表达状态时出现（操作成功、数据异常、有新版本），不做装饰。
   如果主色改成了某个彩色，**成功色必须换一个色相** —— 否则绿色按钮和绿色状态分不清。
3. **深色不是浅色反转。** 深色的画布是冷调近黑 `#0c0c0e`，卡片**比画布亮**一档
   `#161618`。深色下阴影几乎看不见，明度才是深度线索。深色的次要文字也要取更亮的一档。

### 状态色用法

状态色一律「浅底 + 同色深字」，不铺满：

```css
/* 成功 */
background: color-mix(in srgb, var(--success) 10%, transparent);
color: var(--success);

/* 提醒 */
background: color-mix(in srgb, var(--warning) 10%, transparent);
color: var(--warning);

/* 错误 */
background: color-mix(in srgb, var(--destructive) 10%, transparent);
color: var(--destructive);
```

---

## 2. 字体与字阶

**字体栈**：`Geist Variable` 打头，后面跟一串中文回退。这一段必须显式写 ——
少了中文回退，中文会掉到系统默认字体，与拉丁字母的观感脱节。

**只用三档字号**：

| 档位 | 字号 | 用在哪 |
| --- | --- | --- |
| `text-xs` | 12px | 标签、表头、时间戳、说明文字 |
| `text-sm` | 14px | **正文与所有控件的默认字号** |
| `text-base` | 16px | 页面主标题 |

**只用三档字重**：400（正文）、500（标签与按钮）、600（标题）。
不要用 700 —— 中文粗体在 12–14px 下发糊，反而降低可读性。

**数字加 `tabular-nums`**：表格里的计数、版本号、时间戳一律加。
不加的话数字宽度不等，逐行往下看会左右跳。

---

## 3. 间距与圆角

**间距只用 4 的倍数**：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40。
卡片内边距 16–24px，区块之间 16–20px，页面边距 24–32px。

**圆角基准 20px**，由 `--radius` 统一消费：

| 档位 | 值 | 用在哪 |
| --- | --- | --- |
| `rounded-sm` | 6px | 内嵌的小元素 |
| `rounded-md` | 10px | 标签、小按钮 |
| `rounded-lg` | 20px | **按钮、输入框、卡片内芯** |
| `rounded-xl` | 28px | 对话框、卡片外壳 |

### 嵌套容器的圆角公式

```
内圆角 = 外圆角 − 内边距
```

卡片外壳 28px、内边距 6px → 内芯 22px。两条弧才同心。
直接给内外套同一个值，会出现肉眼可见的宽度不均（角上一边厚一边薄）。

---

## 4. 阴影

只有两级，都是极柔扩散：

| 令牌 | 用在哪 |
| --- | --- |
| `--shadow-card` | 卡片外壳。贴面，落影浅 |
| `--shadow-float` | 对话框、下拉、浮出通知。三层，负责「浮起来」 |

### 如果把 Tailwind 的 `shadow-*` 和 `ring-*` 一起用，会踩两个坑

Tailwind 的 `shadow-*` 不是直接写 `box-shadow`，而是把值塞进变量，再由一条声明同时引用：

```css
/* 工具类实际生成的东西 */
.shadow-lg { --tw-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); }
.ring-1    { --tw-ring-shadow: 0 0 0 1px var(--tw-ring-color); }

/* 两者最终共用同一条声明 */
box-shadow:
  var(--tw-ring-offset-shadow, 0 0 #0000),
  var(--tw-ring-shadow, 0 0 #0000),
  var(--tw-shadow);
```

问题有两个：

1. **任一变量在计算时无效，整条声明就作废。** 五个 `--tw-*` 里只要有一个算出非法值，
   整个 `box-shadow` 失效 —— 表现是「写了阴影，但完全没有」。
2. **`ring-*` 会挡住 `shadow-*`。** 这是 Tailwind 有意为之（描边要盖在阴影上面当焦点层），
   但 CSS 没有「阴影偏移」这个概念，两者都是 `box-shadow`，只能叠在一起。

### 避开的方法：固定用一套，另一套不用

**浮层的描边用 `border` 而不是 `ring-1`**，从根上不产生第二个 `box-shadow`。

阴影则写成**不带 `@layer` 的普通类**。CSS 层叠顺序是：

```
@layer theme < base < components < utilities < 不带层的样式
```

**不带层的样式永远赢过任何带层的样式**，跟选择器特异性无关。所以直接写就能生效：

```css
/* 不带任何 @layer，优先级最高 */
.float-shadow {
  box-shadow: var(--shadow-float);
}
```

---

## 5. 卡片：外壳 + 内芯

卡片是两层，不是一层：

```
┌─ 外壳 ── rgba(0,0,0,0.025) + hairline + 落影，圆角 28px，内边距 6px ─┐
│  ┌─ 内芯 ── 纯白 + 顶部内高光，圆角 22px ────────────────────────┐  │
│  │  内容                                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

这样卡片看起来像**嵌在托盘里的一块板子**，而不是浮在背景上的一片色。
只加边框的卡片在这个配色下会显得单薄。

内芯那道顶部内高光用 `box-shadow: inset` 实现，很淡（白色 60% 左右），
作用是在卡片上边缘拉出一条极细的亮线，让平面有厚度感。

---

## 6. 组件规格

### 按钮

| 变体 | 底色 | 字色 | 用在哪 |
| --- | --- | --- | --- |
| `default` | 墨色 | 近白 | **每屏一个**，最重要的那个动作 |
| `outline` | 画布色 + hairline | 正文色 | 常规操作 |
| `secondary` | `--secondary` | 正文色 | 次于 outline 的操作 |
| `ghost` | 透明 | 正文色 | 列表行内、工具条 |
| `destructive` | 危险色 10% | 危险色 | 删除。**必须与主操作分开** |

高度 36px，列表行内的小按钮 28px。
所有按钮都要有按下反馈（向下位移 1px 或底色再深一档），有弹出菜单的除外 ——
点了会弹面板的按钮不适合位移，会让人以为页面抖了一下。

**每屏只有一个主按钮。** 两个同级的实心按钮会让人不知道该点哪个。

### 输入框

高 36px，圆角 20px，底色用 `background`（不是纯白），边框 `--input`。
聚焦时边框变 `--ring`（近黑），**不加外发光** —— 单色界面里突然出现一圈彩色光晕会很跳。

### 对话框

纯白底、圆角 28px、`--shadow-float`、`max-height: 85vh` 且内容区可滚动。
窗口可能被缩得很小，长表单必须能在小窗口里滚到底部的按钮 ——
配合 sticky 的底部按钮条，让按钮始终露在外面。

### 表格

表头用 `--muted` 底、12px、次要文字色。行高 40–48px。
数字列右对齐加 `tabular-nums`，文字列左对齐。

### 徽章

胶囊形，12px。**只用于状态与计数**（条目数、成功/失败），不做装饰性标签。

---

## 7. 交互状态

每个可点元素都要有这四态：

| 状态 | 表现 |
| --- | --- |
| 默认 | 见上表 |
| hover | 底色加深一档（`--muted`）或透明度变化 |
| 按下 | 位移 1px 或底色再深一档 |
| 焦点 | 可见的焦点环（`--ring`），**键盘用户必须看得见** |

**焦点环不是可选项。** 用 `:focus-visible` 而不是 `:focus`，
鼠标点击时不显示、键盘 Tab 时才显示。

---

## 8. 无障碍底线

| 要求 | 标准 |
| --- | --- |
| 正文对比度 | ≥ 4.5:1 |
| 大字号对比度 | ≥ 3:1 |
| 焦点环对比度 | ≥ 3:1（对相邻颜色） |
| 键盘可达 | 所有交互元素都能 Tab 到，顺序与视觉顺序一致 |
| 图标按钮 | 必须有 `aria-label` |
| 状态通知 | 用 `role="status"` + `aria-live="polite"`，读屏能听到 |
| 减少动效 | 必须实现 `prefers-reduced-motion: reduce` |

---

## 9. 反模式（不要做）

- **不要用纯白画布 + 纯白卡片。** 层次只能靠边框撑，界面会平。
- **不要用纯黑 `#000` 和纯白 `#fff` 做正文色。** 用 `#0a0a0b` 和 `#fafafa`。
- **不要在同一个元素上同时用 `ring-*` 和 `shadow-*`。** 它们抢 `box-shadow`。
- **不要用超过三档字号或三档字重。**
- **不要用彩色做品牌色。** 主色是墨色，彩色只留给语义状态。
- **不要给非浮层元素加阴影。** 卡片用 `--shadow-card`，仅此而已。
- **不要用装饰性动画。** 动效只表达状态变化。
- **不要在单色界面里加彩色发光环。**
- **不要写死侧栏宽度。** 做成可拖动（200–420px），值存 `localStorage`。
- **不要用 `100vh` 做布局高度。** 桌面端窗口可缩放，用 flex 让内容列吸收剩余宽度。
- **不要用 emoji 当图标。** 用一套 SVG 图标，全项目统一。

---

## 10. 给生成工具的 Agent

生成新界面时：

1. **直接抄令牌**，不要重新发明配色。YAML 里的值是规范性的。
2. **保留角色的语义**：`--background` 永远是画布，`--card` 永远是内容面。
   想加新颜色就加新的角色名，不要挪用已有的。
3. **先定对比度再定色相**：正文 ≥ 4.5:1、次要 ≥ 3:1、焦点环 ≥ 3:1。
4. **深色单独设计**，不要用反转生成。
5. **嵌套容器的圆角按公式算**，不要内外套同一个值。
6. **每屏一个主按钮。**
7. **焦点环、`prefers-reduced-motion`、`aria-label` 是底线**，不是加分项。
8. **卡片用双层结构**，不要退回单层加边框。
9. 偏离本规范时**说明理由**。规范是默认值，不是牢笼 —— 但偏离必须是有意的。

---

## 11. 完整令牌（直接复制）

以下 CSS 可以整段粘进任何项目，不依赖构建工具。粘在样式表最前面，之后用 `var(--token)` 引用。

```css
:root {
  /* ── 面与文字 ── */
  --background: #f2f2f4;          /* 画布 */
  --foreground: #0a0a0b;          /* 正文与标题 */
  --card: #ffffff;                /* 卡片内芯 */
  --card-foreground: #0a0a0b;
  --popover: #ffffff;             /* 浮层 */
  --popover-foreground: #0a0a0b;

  /* ── 主操作 ── */
  --primary: #0a0a0b;
  --primary-foreground: #fafafa;

  /* ── 次级面与次要文字 ── */
  --secondary: #f4f4f6;
  --secondary-foreground: #0a0a0b;
  --muted: #f4f4f6;
  --muted-foreground: #6b6b73;
  --accent: #f4f4f6;
  --accent-foreground: #0a0a0b;

  /* ── 语义状态 ── */
  --destructive: #b3261e;
  --success: #2f6b3f;
  --warning: #8a5a00;
  --info: #1a5fb4;

  /* ── 线 ── */
  --border: oklch(0 0 0 / 6%);    /* hairline，看得见但不框死 */
  --input: oklch(0 0 0 / 8%);
  --ring: #0a0a0b;                /* 焦点环 */

  /* ── 侧栏 ── */
  --sidebar: #f7f7f9;
  --sidebar-foreground: #0a0a0b;
  --sidebar-accent: #ebebef;
  --sidebar-accent-foreground: #0a0a0b;
  --sidebar-border: oklch(0 0 0 / 6%);

  /* ── 圆角 ── */
  --radius: 1.25rem;              /* 20px，按钮/输入框/卡片内芯用它 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-xl: 28px;              /* 对话框、卡片外壳 */

  /* ── 间距基准 ── */
  --space-unit: 4px;

  /* ── 布局 ── */
  --sidebar-width: 272px;         /* 可拖动时改这个值，范围 200–420px */
  --topbar-height: 48px;

  /* ── 动效 ── */
  --duration-micro: 150ms;
  --duration-base: 200ms;

  /* ── 阴影：极柔扩散，每层都很淡 ── */
  --shadow-card:
    0 1px 2px oklch(0 0 0 / 3%),
    0 8px 24px -8px oklch(0 0 0 / 6%);
  --shadow-float:
    0 1px 2px oklch(0 0 0 / 4%),
    0 8px 24px -4px oklch(0 0 0 / 6%),
    0 24px 48px -12px oklch(0 0 0 / 5%);
}

/* ── 字体：必须显式带中文回退 ── */
:root {
  --font-sans:
    'Geist Variable', 'Microsoft YaHei UI', 'Microsoft YaHei',
    'PingFang SC', 'Noto Sans CJK SC', system-ui, sans-serif;
}

.dark {
  --background: #0c0c0e;
  --foreground: #fafafa;
  /* 深色下卡片比画布亮一档 —— 阴影不起作用，明度才是深度线索 */
  --card: #161618;
  --card-foreground: #fafafa;
  --popover: #1c1c1f;
  --popover-foreground: #fafafa;

  --primary: #fafafa;
  --primary-foreground: #0a0a0b;

  --secondary: #1f1f22;
  --secondary-foreground: #fafafa;
  --muted: #1f1f22;
  --muted-foreground: #8b8b93;    /* 比浅色那档更亮，否则过不了 4.5:1 */
  --accent: #1f1f22;
  --accent-foreground: #fafafa;

  /* 深底上取各色的浅档 */
  --destructive: #e5766f;
  --success: #7fbf92;
  --warning: #d9a441;
  --info: #7aa7e0;

  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 12%);
  --ring: #fafafa;

  --sidebar: #161618;
  --sidebar-foreground: #fafafa;
  --sidebar-accent: #24242a;
  --sidebar-accent-foreground: #fafafa;
  --sidebar-border: oklch(1 0 0 / 8%);
}

/* ── 基础应用 ── */
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
}

/* ── 卡片：外壳 + 内芯 ── */
.card-shell {
  background: rgb(0 0 0 / 2.5%);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 6px;
  box-shadow: var(--shadow-card);
}
.card-core {
  background: var(--card);
  /* 内圆角 = 外圆角 − 内边距，两条弧才同心 */
  border-radius: calc(var(--radius-xl) - 6px);
  /* 顶部内高光：在上边缘拉出一条极细的亮线，让平面有厚度 */
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 60%);
}

/* ── 浮层阴影：不带 @layer，优先级最高 ── */
.float-shadow {
  box-shadow: var(--shadow-float);
}

/* ── 数字等宽 ── */
.tabular {
  font-variant-numeric: tabular-nums;
}

/* ── 尊重减少动效 ── */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 如果项目用 Tailwind v4

把上面的 `:root` / `.dark` 整段放进入口 CSS，再加一段映射，让工具类能读到这些变量：

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-popover: var(--popover);
  --color-primary: var(--primary);
  --color-secondary: var(--secondary);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 14px);
  --radius-md: calc(var(--radius) - 10px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 8px);

  --font-sans: var(--font-sans);
}
```

`@theme inline` 而不是 `@theme`：值需要跟随 `:root` / `.dark` 切换变化，
写成 `inline` 才能让工具类引用变量本身，而不是在构建时把值固化进去。

注意第 4 节说的问题 —— 阴影用不带层的普通类写，不要用 `shadow-*` 工具类。

---

## 12. 修改这份规范

这份规范是按「拿出去就能用」写的，所以：

- 改配色、字号、圆角、阴影时，**YAML 和正文表格要一起改**，别只改一处。
- 第 11 节的 CSS 是规范性产物，**改了令牌就要同步改它** —— 那份 CSS 是别人真正会复制的部分。
- 加新颜色时**起新的角色名**，不要挪用 `--primary` 或 `--accent`。
- 规范与代码不一致时，**以能跑的那个为准**，然后回来修正规范。
  过时的规范比没有规范更糟，它会让照着做的人跑偏。
