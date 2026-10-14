/**
 * 主题三态。`system` = 跟随操作系统，另两个是用户明确指定的。
 *
 * 真正决定深浅的是主进程的 `nativeTheme.themeSource` —— 它一处改动会同时影响
 * 三样东西：渲染层的 `prefers-color-scheme`、Electron 自绘的界面（右键菜单、
 * DevTools）、以及系统画的窗口边框。渲染层只是把这个结果投影成
 * `<html class="dark">`，不自己维护第二份真值。
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

/** 存在 data/settings.json。文件缺失或坏掉都退回默认值 */
export interface SettingsFile {
  version: number
  theme: ThemeChoice
  /**
   * 启动后自动查一次更新。关掉之后只有菜单和侧栏里的「检查更新」会查。
   *
   * 默认开：这个工具是发给同事用的，装了新版却一直不知道才更麻烦。
   * 关掉它不会影响手动检查，也不会影响已经下好的更新继续安装。
   */
  autoCheckUpdate: boolean
}

/** 写设置时提交的改动。只带要改的字段，其余保持原值 */
export type SettingsPatch = Partial<Omit<SettingsFile, 'version'>>

export const DEFAULT_THEME: ThemeChoice = 'system'

export const DEFAULT_AUTO_CHECK_UPDATE = true

/** 校验外部读进来的值：不认识的字符串一律当「跟随系统」，不抛错 */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME
}

/**
 * 校验自动检查开关。只认真正的布尔值，缺失或坏值一律当默认开启。
 *
 * 不能写成「非 true 即 false」：设置文件来自磁盘，被手改坏或写入中断时读到的是
 * 未知类型，那种情况下把人家的自动检查静悄悄关掉，比多查一次糟得多。
 */
export function parseAutoCheckUpdate(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return DEFAULT_AUTO_CHECK_UPDATE
}
