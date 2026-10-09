/**
 * 主题三态。`system` = 跟随操作系统，另两个是用户明确指定的。
 *
 * 真正决定深浅的是主进程的 `nativeTheme.themeSource` —— 它一处改动会同时影响
 * 三样东西：渲染层的 `prefers-color-scheme`、Electron 自绘的界面（右键菜单、
 * DevTools）、以及系统画的窗口边框。渲染层只是把这个结果投影成
 * `<html class="dark">`，不自己维护第二份真值。
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

/** 存在 data/settings.json。文件缺失或坏掉都退回「跟随系统」 */
export interface SettingsFile {
  version: number
  theme: ThemeChoice
}

export const DEFAULT_THEME: ThemeChoice = 'system'

/** 校验外部读进来的值：不认识的字符串一律当「跟随系统」，不抛错 */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME
}
