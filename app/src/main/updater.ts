import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC_CHANNELS } from '../shared/constants/channels'
import type { UpdateState } from '../shared/types/update'
import { getDataDir, isInstalledLayout } from './paths'
import { readSettings, writeSettings } from './store'
import { consumeVersionNotice } from './version-notice'

/** electron-updater 的 AppUpdater。用类型引用，避免顶层 import 把加载失败拖到启动期 */
type AutoUpdater = import('electron-updater').AppUpdater

/**
 * 数据目录里可选的一份更新地址覆盖，形如 {"url":"http://内网服务器/渠道分包工具/"}。
 *
 * 构建时写进 resources/app-update.yml 的地址是死的，内网换个服务器就得重新打包分发。
 * 有这份文件就按它走，装好的机器改一行 JSON 即可。
 */
const FEED_OVERRIDE_FILE = 'update.json'

/**
 * 启动后隔多久查一次更新。
 *
 * 查更新要联网，刚启动时正忙着建窗口、读配置、自检运行时，别在这时候抢带宽与主线程。
 * 装好新版本之后用户一般也不会马上重启，晚几分钟发现完全够用。
 */
const STARTUP_CHECK_DELAY_MS = 15_000

let updater: AutoUpdater | null = null
let loaded = false

let state: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  version: '',
  percent: 0,
  message: '',
  releaseNotes: '',
  manual: false,
  canUpdate: !app.isPackaged || isInstalledLayout(),
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.updateState, state)
    }
  }
}

function patch(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  broadcast()
}

/** 把 electron-updater 的报错翻成人能看懂的一句话 —— 原始信息里全是 URL 与堆栈 */
function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo/i.test(raw)) {
    return '连不上更新服务器，检查一下网络或更新地址。'
  }
  // electron 的网络栈不走 Node 的 errno，域名解析不了时报的是 ERR_NAME_NOT_RESOLVED 这类名字
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE/i.test(raw)) {
    return '连不上更新服务器，检查一下网络或更新地址。'
  }
  if (/ERR_INVALID_URL|ERR_UNESCAPED_CHARACTERS|ERR_INVALID_ARGUMENT/i.test(raw)) {
    return '更新地址填得不对，检查一下 update.json 里的 url。'
  }
  if (/Unable to find latest version on GitHub|Cannot parse releases feed|releases\/latest/i.test(raw)) {
    return 'GitHub 上还没有「已发布」的版本（草稿 Release 不算），先把 Release 发布出来。'
  }
  if (/\b403\b/.test(raw)) {
    return 'GitHub 拒绝了这次请求（403），多半是同一网络里查得太频繁，过一会儿再试。'
  }
  if (/\b404\b/.test(raw)) {
    return '更新服务器上找不到这个版本的信息，可能还没发布新版本。'
  }
  return `检查更新失败：${raw.split('\n')[0]}`
}

/** release notes 在 electron-updater 里的形状：一个字符串，或者按版本分的数组 */
type ReleaseNotes = import('electron-updater').UpdateInfo['releaseNotes']

/**
 * 把 release notes 统一成一段文本。
 *
 * fullChangelog 关着（默认）时它是一整个字符串；开着时是数组，每个版本一条。
 * 拿不到就是 null / undefined —— 一律当空串，界面上据此不显示「更新内容」那一块。
 */
function normalizeReleaseNotes(notes: ReleaseNotes): string {
  if (notes == null) {
    return ''
  }
  if (typeof notes === 'string') {
    return notes
  }
  return notes
    .map((item) => (item.note ?? '').trim())
    .filter((note) => note !== '')
    .join('\n\n')
}

/** 读数据目录里的 update.json（可选），返回里面的更新地址 */
function readFeedUrlOverride(): string | null {
  const file = path.join(getDataDir(), FEED_OVERRIDE_FILE)
  try {
    if (!fs.existsSync(file)) {
      return null
    }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { url?: unknown }
    const url = typeof parsed.url === 'string' ? parsed.url.trim() : ''
    if (!url) {
      console.error(`[updater] ${FEED_OVERRIDE_FILE} 里没有可用的 url，仍用构建时的地址`)
      return null
    }
    return url
  } catch (error) {
    console.error(`[updater] 读 ${FEED_OVERRIDE_FILE} 失败，仍用构建时的地址`, error)
    return null
  }
}

/**
 * 惰性加载 electron-updater。
 *
 * 不用顶层 import：万一打包时漏带了依赖（node_modules 没进包），顶层 import 会让
 * 整个应用起不来 —— 更新只是附加功能，不该有这种权限。加载失败只记一行日志。
 */
async function ensureUpdater(): Promise<AutoUpdater | null> {
  if (loaded) {
    return updater
  }
  loaded = true

  try {
    // electron-updater 是 CJS 包：具名导出靠 Node 对 CJS 的静态分析认出来，
    // 认不出时只剩 default 上有。两条都试，省得某个版本下 autoUpdater 是 undefined。
    type UpdaterModule = typeof import('electron-updater') & {
      default?: typeof import('electron-updater')
    }
    const loadedModule = (await import('electron-updater')) as UpdaterModule
    const autoUpdater = loadedModule.autoUpdater ?? loadedModule.default?.autoUpdater
    if (!autoUpdater) {
      throw new Error('electron-updater 里没有 autoUpdater')
    }

    // 数据目录里放了 update.json 就按它走，改内网地址不用重新打包
    const feedUrl = readFeedUrlOverride()
    if (feedUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    }

    /*
     * 发现新版本不自动下载：先让用户看到「更新了什么」，下不下由他点。
     * 关掉之后 electron-updater 停在 update-available，下载要显式调 downloadUpdate()
     * （见下面导出的 downloadUpdate）。
     */
    autoUpdater.autoDownload = false
    // 下好了但用户没点「立即重启」时，下次关窗口顺手装上
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      patch({ phase: 'checking', version: '', percent: 0, message: '正在检查更新…' })
    })

    autoUpdater.on('update-available', (info) => {
      patch({
        phase: 'available',
        version: info.version,
        percent: 0,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        message: `发现新版本 ${info.version}。`,
      })
    })

    autoUpdater.on('update-not-available', () => {
      // 自动检查没发现新版本是常态，什么都不说；手动点才需要一句回话
      patch({
        phase: state.manual ? 'up-to-date' : 'idle',
        version: '',
        percent: 0,
        message: state.manual ? '已经是最新版本。' : '',
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      patch({
        phase: 'downloading',
        percent: Math.round(progress.percent),
        message: `正在下载新版本 ${state.version}…`,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      patch({
        phase: 'downloaded',
        version: info.version,
        percent: 100,
        message: `新版本 ${info.version} 已下载，重启后生效。`,
      })
    })

    autoUpdater.on('error', (error) => {
      patch({ phase: 'error', percent: 0, message: describeFailure(error) })
    })

    updater = autoUpdater
  } catch (error) {
    console.error('[updater] 加载 electron-updater 失败，本次运行不检查更新', error)
    updater = null
  }

  return updater
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * 查一次更新。manual 为 true 表示用户自己点的（菜单或侧栏里的「检查更新」），
 * 界面会据此把「已经是最新」「检查失败」说出来 —— 自动检查时这两种结果都保持安静。
 */
export async function checkForUpdates(manual: boolean): Promise<UpdateState> {
  /*
   * 已经在查了就不再发起第二次。
   *
   * 两次并发的检查会让 electron-updater 把 up-to-date / error 各报两遍，而界面按
   * 「manual 为真就提示结果」收尾 —— toast 用的是同一个 id，第二次是把第一条顶掉重放，
   * 看起来就是「又弹了一次」。
   *
   * 最容易撞上的时机：启动后那次自动检查（15 秒延迟）还没回来，用户先点了「检查更新」。
   */
  if (state.phase === 'checking') {
    /*
     * 用户这次是主动点的：把「结果要显示出来」记在正在跑的那次身上，
     * 否则他点完什么都看不到。反向不覆盖 —— 手动检查在跑时被自动检查碰一下，
     * 不该把用户那次降级成静默。
     */
    if (manual && !state.manual) {
      patch({ manual: true })
    }
    return state
  }

  patch({ manual })

  // 不是安装包装出来的版本没有安装目录，把安装包装上去只会多出一份莫名其妙的副本
  if (!app.isPackaged || !isInstalledLayout()) {
    patch({
      phase: 'error',
      version: '',
      percent: 0,
      message: '这个版本没有自动更新（不是安装包装出来的）；要自动更新请用安装包安装。',
    })
    return state
  }

  // 已经在下载或下好了就别重来：重新检查会把状态打回 checking，进度条跟着倒退
  if (state.phase === 'downloading' || state.phase === 'downloaded') {
    return state
  }

  /*
   * 已经有结果摆在那儿了，自动检查不必再刷一遍。
   *
   * 重查会把 phase 打回 checking，界面上的更新提示条因此收起来又弹出来，闪一下。
   * 用户点过「稍后」之后也是这样：提示条不该被下一次自动检查重新翻出来。
   * 手动点不受此限 —— 那是用户明确要重新确认一次。
   */
  if (!manual && state.phase === 'available') {
    return state
  }

  const instance = await ensureUpdater()
  if (!instance) {
    patch({ phase: 'error', percent: 0, message: '这个版本里没有带上更新组件，请重新下载安装包。' })
    return state
  }

  patch({ phase: 'checking', version: '', percent: 0, message: '正在检查更新…' })
  try {
    await instance.checkForUpdates()
  } catch (error) {
    // checkForUpdates 同时也会发 error 事件，这里兜住被拒的 promise，避免变成未处理拒绝
    patch({ phase: 'error', percent: 0, message: describeFailure(error) })
  }
  return state
}

/**
 * 用户确认后开始下载新版本。
 *
 * 只有「已经发现新版本」时才动手：正在检查、已经下好、或者压根没有更新时调用都
 * 没有意义，直接返回当前状态，让界面自己看着办。
 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (state.phase !== 'available') {
    return state
  }

  if (!updater) {
    patch({
      phase: 'error',
      version: '',
      percent: 0,
      message: '这个版本里没有带上更新组件，请重新下载安装包。',
    })
    return state
  }

  patch({ phase: 'downloading', percent: 0, message: `正在下载新版本 ${state.version}…` })
  try {
    await updater.downloadUpdate()
  } catch (error) {
    // downloadUpdate 同时也会发 error 事件，这里兜住被拒的 promise，避免变成未处理拒绝
    patch({ phase: 'error', percent: 0, message: describeFailure(error) })
  }
  return state
}

/**
 * 下载完成后立即重启并安装。
 *
 * 界面在调用前必须先确认两件事：没有出包任务在跑（重启会掐掉它），
 * 以及没有未保存的修改（重启会丢）。
 *
 * 两个参数都得显式给：不传的话 electron-updater 的 isSilent 默认是 false，
 * 安装程序会弹出向导 —— 用户已经点过「重启并更新」，不该再被问一遍。
 * isForceRunAfter 也只在 isSilent 为 true 时才被认，否则装完应用不会自己回来。
 */
export function installUpdate(): void {
  updater?.quitAndInstall(true, true)
}

/** 系统会话正在结束（关机 / 重启 / 注销）。见 installSessionEndGuard */
let sessionEnding = false

/**
 * 关机时不装更新。
 *
 * electron-updater 默认会在应用退出时把已下载的更新装上（那条路径本身是静默的，
 * 见 BaseUpdater.addQuitHandler 里的 install(true, false)）。但如果这次退出是系统关机，
 * Windows 会在安装程序跑到一半时把它掐掉，留下「旧的卸了、新的没装上」的残局 ——
 * electron-builder 的 issue #7807 说的就是这个。
 *
 * Windows 上拿不到 powerMonitor 的 shutdown 事件，但每个窗口都会收到 session-end，
 * 那就是关机/注销的信号。退出前把 autoInstallOnAppQuit 关掉，更新留在缓存里，
 * 下次正常关窗口时会装上。
 *
 * electron-updater 7.0 起官方提供 autoInstallEvent = 'onNextLaunch' 做这件事
 * （目前还是 alpha；升上去之后这一段可以整个删掉）。
 */
function installSessionEndGuard(): void {
  app.on('browser-window-created', (_event, win) => {
    win.on('session-end', () => {
      sessionEnding = true
    })
  })

  app.on('before-quit', () => {
    if (sessionEnding && updater) {
      updater.autoInstallOnAppQuit = false
    }
  })
}

/**
 * 装好更新检查。只有安装版才走这条路：
 * 不是安装包装出来的版本没有安装目录，把 NSIS 安装包装上去只会多出一份莫名其妙的副本。
 */
export function initUpdater(): void {
  // 关机守卫跟「是不是安装版」无关，先挂上
  installSessionEndGuard()

  if (!app.isPackaged || !isInstalledLayout()) {
    return
  }
  const timer = setTimeout(() => {
    // 用户关掉了自动检查就别去打扰更新服务器。手动点「检查更新」不受这里影响
    if (!readSettings().autoCheckUpdate) {
      return
    }
    void checkForUpdates(false)
  }, STARTUP_CHECK_DELAY_MS)
  // 别让这个定时器把进程留在后台
  timer.unref?.()
}

/** 当前是否开着「启动时自动检查更新」 */
export function isAutoCheckEnabled(): boolean {
  return readSettings().autoCheckUpdate
}

/**
 * 开关「启动时自动检查更新」。
 *
 * 打开时顺手查一次：用户刚表达完「我要自动检查」的意思，如果只写进文件、等下次
 * 启动才生效，会以为开关没起作用。关掉时不打断已经开始的检查 —— 已经摆在界面上的
 * 新版本照旧提示，用户只是不想每次启动都被查一遍。
 */
export function setAutoCheckEnabled(enabled: boolean): boolean {
  writeSettings({ autoCheckUpdate: enabled })
  if (enabled) {
    void checkForUpdates(false)
  }
  return enabled
}

export function registerUpdateIpc(): void {
  ipcMain.handle(IPC_CHANNELS.updateCheck, () => checkForUpdates(true))
  ipcMain.handle(IPC_CHANNELS.updateDownload, () => downloadUpdate())
  ipcMain.handle(IPC_CHANNELS.updateGetState, () => state)
  ipcMain.handle(IPC_CHANNELS.updateInstall, () => {
    installUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.updateConsumeVersionNotice, () => consumeVersionNotice())
}
