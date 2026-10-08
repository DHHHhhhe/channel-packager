import type { ChannelEntry } from './store'

/** 配置包里 `manifest.json` 的 format 标识，用来一眼分辨「是不是本工具导出的包」 */
export const PACK_FORMAT = 'channel-packager-config'

/** 配置包结构版本。读到更高版本时明确拒绝，而不是猜着读 */
export const PACK_VERSION = 1

export interface PackManifest {
  format: string
  version: number
  exportedAt: string
  jksCount: number
  /** 包内相对路径 → SHA256 */
  files: Record<string, string>
}

export interface PackConflict {
  id: string
  displayName: string
  /** 本机现有副本的 SHA256 */
  existingSha256: string
  /** 配置包里那份的 SHA256 */
  incomingSha256: string
}

/** 同 id 但内容不同时的处理方式 */
export type ConflictStrategy = 'skip' | 'keep-both' | 'overwrite'

export interface PackExportResult {
  canceled: boolean
  path?: string
  fileCount?: number
  totalBytes?: number
}

export interface PackPreviewResult {
  canceled: boolean
  packPath?: string
  exportedAt?: string
  jksCount?: number
  keystoreCount?: number
  channelCount?: number
  hasTemplate?: boolean
  /** 本机模板已被改过（与内置种子不同），导入模板会覆盖它 */
  templateDiffers?: boolean
  conflicts?: PackConflict[]
}

export interface PackImportResult {
  importedJks: number
  skipped: number
  overwritten: number
  /** 「保留两份」自动加后缀的条数 */
  renamed: number
  importedTemplate: boolean
  notes: string[]
}

/** 导入渠道 JSON 时，对界面现有列表的处理方式 */
export type ChannelImportMode = 'overwrite' | 'append'

/**
 * 「导入前先看一眼」的解析结果。
 *
 * 主进程只读文件、把文件里的条目原样算出来，**不落盘**。
 * 确认后由渲染层把（用户在预览框里改过的）条目合并进界面上的列表，
 * 真正的落盘发生在「保存渠道列表」那一步 —— 所以这里没有路径：
 * 文件只在解析时读一次，之后磁盘上再变也影响不到已经读进界面的内容。
 */
export interface ChannelListPreview {
  /** 只取文件名，用于在对话框里显示「导入的是哪个文件」 */
  fileName: string
  /** 文件里的条目，顺序与文件里一致 */
  channels: ChannelEntry[]
  count: number
  /** 需要让用户知道的忽略项或副作用（如 app 不一致） */
  notes: string[]
}

export interface ChannelExportResult {
  canceled: boolean
  path?: string
  count?: number
}

/**
 * 「导出示例 JSON」的结果。
 * 只在渠道列表为空时提供 —— 给用户一份可直接改的起点，改完用「导入 JSON」读回来。
 */
export interface ChannelSampleExportResult {
  canceled: boolean
  path?: string
  count?: number
  /** 示例条目来自「渠道模板」页的模板（否则是内置的两条兜底示例） */
  fromTemplate?: boolean
}
