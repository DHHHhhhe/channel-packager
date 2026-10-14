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
  /**
   * 上一次运行时的版本号。空串表示还没记录过（第一次装，或者设置文件被删了）。
   *
   * 用途只有一个：下次启动时如果它和当前版本不一样，说明刚更新过，
   * 界面据此提示一句「已更新到 x.y.z」。用户点完「重启并更新」在装机那几十秒里
   * 看不到任何界面，回来之后得有个东西告诉他成了。
   */
  lastRunVersion: string
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

/**
 * 校验「上次运行的版本」。
 *
 * 不认识的类型一律当空串（= 没记录过）。空串的语义是「不提示更新」，
 * 所以设置文件坏掉时最多是少提示一次，不会凭空冒出一句「已更新到」。
 */
export function parseLastRunVersion(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
