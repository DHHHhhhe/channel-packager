import { app } from 'electron'
import { readSettings, writeSettings } from './store'

/**
 * 「刚更新过」的一次性提示。
 *
 * 装更新的那几十秒里应用是关着的，用户看不到任何界面 —— 没有进度、没有完成提示。
 * 回来之后得有个东西告诉他「成了、现在是哪个版本」，否则他没法区分
 * 「更新成功」和「点了没反应」。
 *
 * 只留在内存里，不落盘：它是一次性的，重启一次就该消失。
 */
let pendingFrom: string | null = null

/**
 * 启动时记一笔：这次跑的版本和上次跑的不一样，就是刚更新过。
 *
 * 要在窗口起来之前调用 —— 渲染层一挂载就会来取，晚了它取到的是空。
 */
export function initVersionNotice(): void {
  const current = app.getVersion()
  const lastRun = readSettings().lastRunVersion

  /*
   * 空值不提示。第一次装、或者设置文件被删过，都不是「更新」，
   * 这时候凑一句「已更新到」只会让人以为刚刚出了什么事。
   */
  pendingFrom = lastRun !== '' && lastRun !== current ? lastRun : null

  if (lastRun !== current) {
    writeSettings({ lastRunVersion: current })
  }
}

/**
 * 取走待提示的版本变化。取过一次就没了 —— 否则每开一个窗口都会再弹一遍。
 *
 * 返回 null 表示这次启动没什么要说的（版本没变，或本来就没记录）。
 */
export function consumeVersionNotice(): { from: string; to: string } | null {
  if (pendingFrom === null) {
    return null
  }
  const notice = { from: pendingFrom, to: app.getVersion() }
  pendingFrom = null
  return notice
}
