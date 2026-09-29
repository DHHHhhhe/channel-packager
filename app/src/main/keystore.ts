import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { JksItem, JksMutationResult, RefreshResult } from '../shared/types/store'
import { baseNameOf, deriveAlias, derivePassword } from '../shared/utils/credentials'
import { resolveInData } from './paths'
import { deleteChannels, readJksFile, writeChannels, writeJksFile } from './store'

/** jks 只有几 KB，直接整读进内存算摘要即可 */
export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

/** 副本在 data/ 下的相对路径。统一存正斜杠，JSON 跨平台可读 */
export function keystoreRelativePath(id: string): string {
  return `keystores/${id}.jks`
}

/** 同 id 已被占用时退到 <id>_2、<id>_3…，绝不覆盖已有副本 */
export function allocateId(baseId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseId)) {
    return baseId
  }
  let index = 2
  while (taken.has(`${baseId}_${index}`)) {
    index += 1
  }
  return `${baseId}_${index}`
}

export interface AddKeystoreOptions {
  displayName?: string
  alias?: string
  storePassword?: string
  app?: string
}

/**
 * 新增 jks：把源文件复制成 data/keystores/<id>.jks 并入库。
 * 之后签名与凭据校验只用副本，sourcePath 仅用于显示与刷新（R21）。
 */
export function addKeystore(sourcePath: string, options: AddKeystoreOptions = {}): JksMutationResult {
  const file = readJksFile()
  const stat = fs.statSync(sourcePath)
  const sha256 = sha256File(sourcePath)
  const baseId = baseNameOf(sourcePath)

  const sameId = file.items.find((item) => item.id === baseId)
  if (sameId && sameId.sha256 === sha256) {
    return {
      status: 'duplicate',
      items: file.items,
      message: `「${baseId}」已存在且内容相同，已跳过`,
    }
  }

  const id = allocateId(baseId, new Set(file.items.map((item) => item.id)))
  const keystoreFile = keystoreRelativePath(id)
  fs.copyFileSync(sourcePath, resolveInData(keystoreFile))

  const derivedAlias = deriveAlias(sourcePath)
  const derivedPassword = derivePassword(sourcePath)
  const alias = options.alias ?? derivedAlias
  const storePassword = options.storePassword ?? derivedPassword

  const item: JksItem = {
    id,
    displayName: options.displayName ?? path.basename(sourcePath),
    keystoreFile,
    sourcePath,
    sha256,
    fileSize: stat.size,
    alias,
    storePassword,
    app: options.app ?? id,
    // 判定依据是最终值是否等于按文件名推导的结果。界面会先自动带出再让用户改，
    // 所以不能看「调用方有没有传值」——那样永远都是手工，这个字段就失去意义了
    credentialSource:
      alias === derivedAlias && storePassword === derivedPassword ? 'derived' : 'manual',
    importedAt: new Date().toISOString(),
  }

  file.items.push(item)
  writeJksFile(file)
  // 顺手建一份空的渠道文件，保证 channels/<id>.json 与条目一一对应
  writeChannels(id, { defaultExtraInfo: { app: item.app }, channelInfoList: [] })

  return { status: 'added', items: file.items, item }
}

export function updateJksItem(item: JksItem): JksMutationResult {
  const file = readJksFile()
  const index = file.items.findIndex((existing) => existing.id === item.id)
  if (index < 0) {
    throw new Error(`找不到 jks：${item.id}`)
  }
  file.items[index] = item
  writeJksFile(file)
  return { status: 'updated', items: file.items, item }
}

/** 删除条目时一并清掉副本与渠道文件，否则同 id 重新导入会读到上一份渠道列表 */
export function removeJksItem(id: string): JksMutationResult {
  const file = readJksFile()
  const target = file.items.find((item) => item.id === id)
  if (!target) {
    throw new Error(`找不到 jks：${id}`)
  }

  // 先解析副本路径：越界就直接失败，不要先改了列表再报错
  const copyPath = resolveInData(target.keystoreFile)

  file.items = file.items.filter((item) => item.id !== id)
  writeJksFile(file)
  fs.rmSync(copyPath, { force: true })
  deleteChannels(id)

  return { status: 'removed', items: file.items }
}

/**
 * 从原文件重新读取并与记录的指纹比对。
 * 只报告差异，不自动同步 —— 覆盖副本要用户确认（设计里明确要求）。
 */
export function refreshFromSource(id: string): RefreshResult {
  const item = readJksFile().items.find((entry) => entry.id === id)
  if (!item) {
    throw new Error(`找不到 jks：${id}`)
  }

  let sha256: string
  let fileSize: number
  try {
    fileSize = fs.statSync(item.sourcePath).size
    sha256 = sha256File(item.sourcePath)
  } catch {
    // 源文件被移动/删除完全不影响出包，副本才是签名依据
    return { status: 'source-unavailable', message: `原文件不可访问：${item.sourcePath}` }
  }

  if (sha256 === item.sha256) {
    return { status: 'unchanged', sourceSha256: sha256, sourceFileSize: fileSize }
  }
  return { status: 'changed', sourceSha256: sha256, sourceFileSize: fileSize }
}
