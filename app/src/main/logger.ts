import fs from 'node:fs'
import path from 'node:path'
import { getLogsDir } from './paths'

export interface TaskLogger {
  file: string
  section(title: string): void
  info(message: string): void
  child(tag: string, line: string): void
  error(message: string): void
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

/** 日志最多留几份 */
export const MAX_LOG_FILES = 30
/** 日志总体积上限 */
export const MAX_LOG_TOTAL_BYTES = 50 * 1024 * 1024
/** 无论多大都至少留最近这么多份，免得「出问题那几次的日志正好被清掉」 */
export const MIN_KEEP_LOGS = 10

/**
 * 清理旧日志：按修改时间从最旧的开始删，直到份数与总体积都回到上限之内。
 *
 * 出包一次就是几万字，一个包的全流程输出几十上百 KB，不清理会无限涨。清理失败
 * 一律吞掉 —— 这是收尾动作，不能因为它把出包本身搞失败。
 */
export function pruneTaskLogs(dir: string = getLogsDir()): number {
  let entries: { file: string; size: number; mtimeMs: number }[]
  try {
    entries = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => {
        const file = path.join(dir, name)
        const stat = fs.statSync(file)
        return { file, size: stat.size, mtimeMs: stat.mtimeMs }
      })
  } catch {
    // 目录还不存在、或者读不了：当作没有旧日志
    return 0
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs) // 新 → 旧
  let remaining = entries.length
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)
  let removed = 0

  for (let index = entries.length - 1; index >= MIN_KEEP_LOGS; index -= 1) {
    if (remaining <= MAX_LOG_FILES && total <= MAX_LOG_TOTAL_BYTES) {
      break
    }
    const entry = entries[index]
    try {
      fs.rmSync(entry.file, { force: true })
      remaining -= 1
      total -= entry.size
      removed += 1
    } catch {
      // 删不掉就留着，继续看下一份
    }
  }

  return removed
}

/**
 * 每次出包一份日志，UTF-8 落盘。
 *
 * 任务结束后**不删除** —— 验收要求「处理失败后日志文件仍在，可看到 walle 或
 * apksigner 的原始输出」。删掉就等于失败时无从查起。
 */
export function createTaskLogger(taskId: string): TaskLogger {
  // 先清旧的再写新的：本轮这份是刚建的，永远是最新的一份，不会被清掉
  pruneTaskLogs()
  const file = path.join(getLogsDir(), `${taskId}.log`)
  fs.writeFileSync(file, '', 'utf8')
  const append = (text: string): void => {
    fs.appendFileSync(file, `${text}\n`, 'utf8')
  }
  return {
    file,
    section(title) {
      append(`\n===== ${stamp()} ${title} =====`)
    },
    info(message) {
      append(`[${stamp()}] ${message}`)
    },
    child(tag, line) {
      append(`[${stamp()}] <${tag}> ${line}`)
    },
    error(message) {
      append(`[${stamp()}] !! ${message}`)
    },
  }
}
