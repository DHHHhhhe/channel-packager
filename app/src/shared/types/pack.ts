import type { ChannelConfig } from './store'

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

export interface ChannelImportResult {
  config: ChannelConfig
  count: number
  /** 被忽略或与 jks 不一致的字段说明 */
  notes: string[]
}

export interface ChannelExportResult {
  canceled: boolean
  path?: string
  count?: number
}
