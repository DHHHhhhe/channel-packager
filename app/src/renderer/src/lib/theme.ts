/**
 * 主题在渲染层这一侧的落地。
 *
 * 深浅的**真源在主进程**：`nativeTheme.themeSource` 一处改动会同时决定渲染层的
 * `prefers-color-scheme`、Electron 自绘界面与系统画的窗口边框。所以这里不去
 * 自己判断「选的是哪一档」，只把媒体查询的结果投影成 `<html class="dark">` ——
 * 三档（跟随系统 / 浅色 / 深色）在设好 themeSource 之后都会如实反映在媒体查询上，
 * 少一处可能对不上的判断。
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 当前是否该用深色。由主进程的 themeSource 决定，包含「跟随系统」的结果 */
export function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

/** 挂/摘 `<html class="dark">`。index.css 的 .dark 令牌块与所有 dark: 工具类都靠它 */
export function applyThemeClass(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * 订阅深浅变化，返回取消订阅函数。
 * 除了操作系统自己切换，用户改主题档位时主进程改 themeSource 也会触发它。
 */
export function watchTheme(listener: (dark: boolean) => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  const handler = (event: MediaQueryListEvent): void => listener(event.matches)
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}
