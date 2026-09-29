import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR_NAME = 'data'
const RUNTIME_DIR_NAME = '.runtime'
const SUB_DIRS = ['keystores', 'channels', 'logs'] as const

let dataDir = ''
let usedFallback = false

/**
 * 便携版 exe 每次启动自解压到 %TEMP%，`path.dirname(app.getPath('exe'))` 指向的是临时目录，
 * 数据写进去下次启动就没了 —— 必须用 electron-builder 注入的 PORTABLE_EXECUTABLE_DIR。
 *
 * 开发态不能用 `app.getPath('exe')`：那时它指向 `node_modules/electron/dist/electron.exe`，
 * 数据会落进 node_modules 并被下一次重装清掉。开发态改用工程根目录。
 */
function preferredDataDir(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    return path.join(portableDir, DATA_DIR_NAME)
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
 * 否则 Chromium 缓存仍会另落一份到 %APPDATA%，便携版就不便携了。
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
