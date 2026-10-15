/**
 * 自动更新的对外状态。
 *
 * 主进程是唯一真值：它跑 electron-updater，每次变化都推给渲染层；
 * 渲染层只做两件事 —— 订阅（onUpdateState）和主动查（checkUpdate）。
 */
export type UpdatePhase =
  /** 没在检查，也没有待处理的更新 */
  | 'idle'
  /** 正在问服务器 */
  | 'checking'
  /** 有新版本，等用户决定下不下 —— autoDownload 关着，下载由用户点出来 */
  | 'available'
  /** 下载中 */
  | 'downloading'
  /** 下好了，等用户重启 */
  | 'downloaded'
  /** 已经是最新（只有手动检查才看得到） */
  | 'up-to-date'
  /** 检查或下载失败 */
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** 当前运行的版本 */
  currentVersion: string
  /** 新版本号；没有可用更新时为空串 */
  version: string
  /** 下载进度 0-100，不在下载时为 0 */
  percent: number
  /** 给用户看的中文说明 */
  message: string
  /** 这次检查是不是用户手动点的：自动检查失败时不该弹提示打扰人 */
  manual: boolean
  /**
   * 新版本更新了什么。来自 Release 的正文（GitHub provider 从 atom feed 的
   * content 取），可能是 HTML —— 转文本由渲染层做，主进程不碰 DOM。
   * 没写更新内容、或者拿不到时是空串。
   */
  releaseNotes: string
  /**
   * 这个形态有没有自动更新可用。
   *
   * 开发态一律为 true：那时 app.isPackaged 为假，检查会走「没有安装目录」那条分支
   * 并给出明确报错 —— 本地得先看得见这个入口才能自测。
   * 打包后只有安装版为 true；不是安装版的为 false（菜单里那一项也是按同一条件隐藏的）。
   */
  canUpdate: boolean
}
