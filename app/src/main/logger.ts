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

/**
 * 每次出包一份日志，UTF-8 落盘。
 *
 * 任务结束后**不删除** —— 验收要求「处理失败后日志文件仍在，可看到 walle 或
 * apksigner 的原始输出」。删掉就等于失败时无从查起。
 */
export function createTaskLogger(taskId: string): TaskLogger {
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
