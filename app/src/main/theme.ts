import { BrowserWindow, nativeTheme } from 'electron'
import type { ThemeChoice } from '../shared/types/settings'
import { readSettings, writeSettings } from './store'

/**
 * 窗口底色。Chromium 在首帧之前画的就是它 —— 深色下给白色，启动瞬间会闪一下白。
 *
 * 取值对齐 styles/index.css 里 `:root` / `.dark` 的 `--background`
 * （oklch(1 0 0) / oklch(0.145 0 0)，后者即 Tailwind 的 neutral-950）。
 */
const BACKGROUND_LIGHT = '#ffffff'
const BACKGROUND_DARK = '#0a0a0a'

/** 当前生效的窗口底色。必须在 themeSource 设好之后调用 */
export function currentBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND_DARK : BACKGROUND_LIGHT
}

/**
 * 把主题选择交给 Electron。
 *
 * `themeSource` 是**唯一**的真源：设成 dark 会让渲染层的 `prefers-color-scheme`
 * 匹配 dark，也让 Electron 自绘的界面（右键菜单、DevTools）与系统画的窗口边框
 * 一起变深。渲染层因此不需要自己判断系统偏好，照抄这个结果即可。
 */
export function applyNativeTheme(choice: ThemeChoice): void {
  nativeTheme.themeSource = choice
  const background = currentBackgroundColor()
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(background)
  }
}

/** 读盘上的选择并应用。建窗口**之前**调用，返回实际生效的值 */
export function initTheme(): ThemeChoice {
  const choice = readSettings().theme
  applyNativeTheme(choice)
  return choice
}

/** 用户切换主题：落盘 + 立即生效，返回实际生效的选择 */
export function saveTheme(choice: ThemeChoice): ThemeChoice {
  writeSettings({ theme: choice })
  applyNativeTheme(choice)
  return choice
}
