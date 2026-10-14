import fs from 'node:fs'
import { app } from 'electron'
import { readSettings, settingsFilePath, writeSettings } from './store'

/**
 * 「刚更新过」的一次性提示。
 *
 * 装更新的那几十秒里应用是关着的，用户看不到任何界面 —— 没有进度、没有完成提示。
 * 回来之后得有个东西告诉他「成了、现在是哪个版本」，否则他没法区分
 * 「更新成功」和「点了没反应」。
 *
 * 只留在内存里，不落盘：它是一次性的，重启一次就该消失。
 */
let pending: { from: string; to: string } | null = null

/**
 * 启动时记一笔：这次跑的版本和上次跑的不一样，就是刚更新过。
 *
 * 要在窗口起来之前调用 —— 渲染层一挂载就会来取，晚了它取到的是空。
 */
export function initVersionNotice(): void {
  const current = app.getVersion()
  // 读之前先问一句文件在不在 —— 它是「第一次装」和「从旧版升上来」的分界
  const hadSettings = fs.existsSync(settingsFilePath())
  const lastRun = readSettings().lastRunVersion

  if (lastRun !== '' && lastRun !== current) {
    // 有记录、且和当前版本不一样：标准的「刚更新过」
    pending = { from: lastRun, to: current }
  } else if (lastRun === '' && hadSettings) {
    /*
     * 文件在、却没记录过版本 —— 说明是从「还不认识这个字段」的旧版升上来的。
     * 只知道更新过、说不清从哪一版来，from 留空，由界面降级成一句话。
     *
     * 加这一条是因为：带上这个字段的第一个版本，自己看不到自己的提示 ——
     * 用户升级到它的时候，跑的还是旧版的代码，而旧版压根不写这个字段。
     * 不加的话，恰好是「最该告诉用户更新成功了」的那一次最安静。
     */
    pending = { from: '', to: current }
  } else {
    // 记录为空、文件本来也不在：第一次装。这不是更新，不该提示
    pending = null
  }

  if (lastRun !== current) {
    writeSettings({ lastRunVersion: current })
  }
}

/**
 * 取走待提示的版本变化。取过一次就没了 —— 否则每开一个窗口都会再弹一遍。
 *
 * `from` 为空串表示「知道更新过，但不知道从哪一版来」（见上面那个分支）。
 * 返回 null 表示这次启动没什么要说的。
 */
export function consumeVersionNotice(): { from: string; to: string } | null {
  if (pending === null) {
    return null
  }
  const notice = pending
  pending = null
  return notice
}
