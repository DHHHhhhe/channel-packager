import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR_NAME = 'data'
const RUNTIME_DIR_NAME = '.runtime'
const SUB_DIRS = ['keystores', 'channels', 'logs'] as const

/** 安装包在安装目录里留的标记文件，见 build/installer.nsh */
const INSTALLED_MARKER = '.installed'

/** 安装版的数据目录名，与 electron-builder.yml 的 productName 一致 */
const INSTALLED_DIR_NAME = '渠道分包工具'

let dataDir = ''
let usedFallback = false

/**
 * 是不是安装包装出来的（安装目录里有标记文件）。
 *
 * 不能只看 exe 路径像不像 Program Files：默认安装位置本来就是
 * %LOCALAPPDATA%\Programs，而手动解压出来的 win-unpacked 被人挪到那儿也不该算。
 * 只有安装脚本写下的那个标记文件才算数。
 */
export function isInstalledLayout(): boolean {
  if (!app.isPackaged) {
    return false
  }
  try {
    return fs.existsSync(path.join(path.dirname(app.getPath('exe')), INSTALLED_MARKER))
  } catch {
    return false
  }
}

/**
 * 安装版的数据目录：%LOCALAPPDATA%\渠道分包工具\data。
 *
 * 为什么不放 exe 旁边：安装在 %LOCALAPPDATA%\Programs 下，卸载会连安装目录一起删，
 * 渠道配置、jks 副本和明文口令就跟着没了。
 *
 * 为什么不用漫游的 %APPDATA%：那里会跟着域账号漫游同步，而 data 里还有 .runtime
 * （Chromium 缓存，几百 MB），同步它纯属浪费。
 */
function installedDataDir(): string {
  const localAppData = process.env.LOCALAPPDATA ?? app.getPath('appData')
  return path.join(localAppData, INSTALLED_DIR_NAME, DATA_DIR_NAME)
}

/**
 * 数据目录：安装版放系统用户目录，其余放在程序自己旁边。
 *
 * 安装版必须另放一处 —— 见 installedDataDir 的说明。
 *
 * 兜底那条覆盖两种情形：手动解压 win-unpacked 直接跑、以及开发态。
 * 开发态不能用 `app.getPath('exe')`：那时它指向 `node_modules/electron/dist/electron.exe`，
 * 数据会落进 node_modules 并被下一次重装清掉，所以改用工程根目录。
 */
function preferredDataDir(): string {
  if (isInstalledLayout()) {
    return installedDataDir()
  }
  const base = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath()
  return path.join(base, DATA_DIR_NAME)
}

/** 真写一个探针文件，而不是看 fs.access —— 只读介质、ACL、杀软占用都可能让它说谎 */
function ensureWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, `.write-probe-${process.pid}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

function ensureLayout(dir: string): void {
  for (const sub of SUB_DIRS) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  fs.mkdirSync(path.join(dir, RUNTIME_DIR_NAME), { recursive: true })
}

/**
 * 解析并落定数据目录。
 * 必须在 app ready 之前调用：`app.setPath('userData')` 要在此之前生效，
 * 否则 Chromium 缓存会另落一份到 %APPDATA%，数据就被拆成两处了。
 */
export function initPaths(): void {
  const preferred = preferredDataDir()
  usedFallback = !ensureWritable(preferred)

  // 回退位置必须在改写 userData 之前取，否则取到的是被改写后的值
  dataDir = usedFallback ? path.join(app.getPath('userData'), DATA_DIR_NAME) : preferred

  ensureLayout(dataDir)
  app.setPath('userData', path.join(dataDir, RUNTIME_DIR_NAME))
}

export function getDataDir(): string {
  if (!dataDir) {
    throw new Error('数据目录尚未初始化，请先调用 initPaths()')
  }
  return dataDir
}

export function isUsingFallbackDataDir(): boolean {
  return usedFallback
}

/** 把相对 data/ 的路径解析成绝对路径，并挡住 ../ 逃逸 */
export function resolveInData(relativePath: string): string {
  const root = getDataDir()
  const full = path.resolve(root, relativePath)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error(`路径越出数据目录：${relativePath}`)
  }
  return full
}

export function getKeystoresDir(): string {
  return path.join(getDataDir(), 'keystores')
}

export function getChannelsDir(): string {
  return path.join(getDataDir(), 'channels')
}

export function getLogsDir(): string {
  return path.join(getDataDir(), 'logs')
}
