import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TEMPLATE_SEED } from '../shared/constants/templateSeed'
import type { JksItem, TemplateSuffix } from '../shared/types/store'
import {
  PACK_FORMAT,
  PACK_VERSION,
  type ChannelImportResult,
  type ConflictStrategy,
  type PackConflict,
  type PackExportResult,
  type PackImportResult,
  type PackManifest,
  type PackPreviewResult,
  type TemplateImportResult,
} from '../shared/types/pack'
import { buildChannelsFromTemplate, parseChannelConfig } from '../shared/utils/channels'
import { allocateId, keystoreRelativePath, sha256File } from './keystore'
import { getChannelsDir, getKeystoresDir } from './paths'
import { runProcess, tailLines } from './proc'
import { resolveRuntimeComponentPath } from './runtime'
import {
  JKS_FILE_VERSION,
  jksFilePath,
  readChannels,
  readJksFile,
  readTemplate,
  templateFilePath,
  writeChannels,
  writeJksFile,
  writeTemplate,
} from './store'

const MANIFEST_NAME = 'manifest.json'
const JKS_NAME = 'jks.json'
const TEMPLATE_NAME = 'template.json'
const KEYSTORES_DIR = 'keystores'
const CHANNELS_DIR = 'channels'

/** 上限只用于挡住「明显不是配置包」的超大文件，正常配置包是几百 KB */
const MAX_PACK_BYTES = 512 * 1024 * 1024

/**
 * 把包内相对路径解析成绝对路径，并挡住 `..` 与绝对路径。
 * `jar --extract` 实测本身不会写到目标目录之外（已用含 `../` 条目的包验证过），
 * 这里再挡一层：manifest 里的路径由包作者提供，不能直接信。
 */
function safeJoin(root: string, relative: string): string {
  const rootAbs = path.resolve(root)
  const target = path.resolve(rootAbs, relative)
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
    throw new Error(`配置包里存在非法路径：${relative}`)
  }
  return target
}

function copyInto(sourceDir: string, relative: string, target: string): void {
  const from = safeJoin(sourceDir, relative)
  if (!fs.existsSync(from)) {
    throw new Error(`配置包里缺少文件：${relative}`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(from, target)
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return []
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}

/** 解析并校验包里的 jks.json；条目字段缺失就报错，不猜 */
function parseIncomingJks(text: string): JksItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('配置包里的 jks.json 不是合法的 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('配置包里的 jks.json 不是对象')
  }
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) {
    throw new Error('配置包里的 jks.json 缺少 items 数组')
  }

  const seen = new Set<string>()
  return items.map((raw, index) => {
    const position = `jks.json items[${index}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`${position} 必须是对象`)
    }
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '') {
      throw new Error(`${position} 缺少 id`)
    }
    if (seen.has(id)) {
      throw new Error(`配置包里的 jks.json 有重复 id：${id}`)
    }
    seen.add(id)

    const keystoreFile = typeof entry.keystoreFile === 'string' ? entry.keystoreFile : ''
    if (keystoreFile === '') {
      throw new Error(`${position}（${id}）缺少 keystoreFile`)
    }
    if (!keystoreFile.startsWith(`${KEYSTORES_DIR}/`)) {
      throw new Error(`${position}（${id}）的 keystoreFile 必须位于 ${KEYSTORES_DIR}/ 下`)
    }

    return {
      id,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : id,
      keystoreFile,
      sourcePath: typeof entry.sourcePath === 'string' ? entry.sourcePath : '',
      sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
      fileSize: typeof entry.fileSize === 'number' ? entry.fileSize : 0,
      alias: typeof entry.alias === 'string' ? entry.alias : '',
      storePassword: typeof entry.storePassword === 'string' ? entry.storePassword : '',
      app: typeof entry.app === 'string' ? entry.app : '',
      credentialSource: entry.credentialSource === 'manual' ? 'manual' : 'derived',
      importedAt: typeof entry.importedAt === 'string' ? entry.importedAt : new Date().toISOString(),
    }
  })
}

function readManifest(dir: string): PackManifest {
  const file = path.join(dir, MANIFEST_NAME)
  if (!fs.existsSync(file)) {
    throw new Error(`这不是本工具导出的配置包：缺少 ${MANIFEST_NAME}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`${MANIFEST_NAME} 不是合法的 JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_NAME} 不是对象`)
  }
  const record = parsed as Record<string, unknown>
  if (record.format !== PACK_FORMAT) {
    throw new Error(`不是本工具的配置包（format = ${String(record.format)}）`)
  }
  const version = typeof record.version === 'number' ? record.version : 0
  if (version > PACK_VERSION) {
    throw new Error(`配置包版本 ${version} 高于本程序支持的 ${PACK_VERSION}，请升级工具后再导入`)
  }
  const files = record.files
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new Error(`${MANIFEST_NAME} 缺少 files 校验表`)
  }
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(files as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`${MANIFEST_NAME} 里 ${key} 的 SHA256 不是字符串`)
    }
    normalized[key] = value
  }
  return {
    format: PACK_FORMAT,
    version,
    exportedAt: typeof record.exportedAt === 'string' ? record.exportedAt : '',
    jksCount: typeof record.jksCount === 'number' ? record.jksCount : 0,
    files: normalized,
  }
}

/** 逐文件核对 SHA256，不符即中止并指明是哪个文件 */
function verifyManifest(dir: string, manifest: PackManifest): void {
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const target = safeJoin(dir, relative)
    if (!fs.existsSync(target)) {
      throw new Error(`配置包里缺少文件：${relative}`)
    }
    const actual = sha256File(target)
    if (actual !== expected) {
      throw new Error(`文件校验失败：${relative}（SHA256 与 manifest 不符，配置包可能已损坏或被改过）`)
    }
  }
}

interface Extracted {
  dir: string
  manifest: PackManifest
}

/** 解压到临时目录并校验；失败时自己清理，成功时交给调用方清理 */
async function extractAndVerify(packPath: string): Promise<Extracted> {
  if (!fs.existsSync(packPath)) {
    throw new Error(`配置包不存在：${packPath}`)
  }
  const size = fs.statSync(packPath).size
  if (size > MAX_PACK_BYTES) {
    throw new Error(`配置包过大（${Math.round(size / 1024 / 1024)} MB），已拒绝处理`)
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-pack-in-'))
  try {
    const result = await runProcess(
      resolveRuntimeComponentPath('jar'),
      ['--extract', `--file=${packPath}`],
      { cwd: dir, encoding: 'gbk' },
    )
    if (result.code !== 0) {
      throw new Error(`解压配置包失败：${tailLines(result.stdout + result.stderr)}`)
    }
    const manifest = readManifest(dir)
    verifyManifest(dir, manifest)
    return { dir, manifest }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

export interface PackExportInput {
  targetPath: string
}

/** 导出配置包。只含 jks.json / keystores / channels / template.json，**不含 logs 与 .runtime** */
export async function exportConfigPack(input: PackExportInput): Promise<PackExportResult> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-pack-out-'))
  try {
    const files: Record<string, string> = {}
    const stage = (relative: string, sourcePath: string): void => {
      const target = safeJoin(staging, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(sourcePath, target)
      files[relative] = sha256File(sourcePath)
    }

    // 先读一次模板：文件不存在时 readTemplate 会落一份种子，避免导出缺文件
    readTemplate()
    stage(JKS_NAME, jksFilePath())
    stage(TEMPLATE_NAME, templateFilePath())

    for (const name of listFiles(getKeystoresDir())) {
      stage(`${KEYSTORES_DIR}/${name}`, path.join(getKeystoresDir(), name))
    }
    for (const name of listFiles(getChannelsDir())) {
      stage(`${CHANNELS_DIR}/${name}`, path.join(getChannelsDir(), name))
    }

    const manifest: PackManifest = {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      exportedAt: new Date().toISOString(),
      jksCount: readJksFile().items.length,
      files,
    }
    fs.writeFileSync(path.join(staging, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    fs.mkdirSync(path.dirname(input.targetPath), { recursive: true })
    fs.rmSync(input.targetPath, { force: true })
    const result = await runProcess(
      resolveRuntimeComponentPath('jar'),
      ['--create', '--no-manifest', `--file=${input.targetPath}`, '-C', staging, '.'],
      { encoding: 'gbk' },
    )
    if (result.code !== 0) {
      throw new Error(`打包失败：${tailLines(result.stdout + result.stderr)}`)
    }

    return {
      canceled: false,
      path: input.targetPath,
      fileCount: Object.keys(files).length,
      totalBytes: fs.statSync(input.targetPath).size,
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/** 本机模板是否已被改过（与内置种子不同） */
function localTemplateDiffers(): boolean {
  const current = readTemplate().suffixes
  if (current.length !== TEMPLATE_SEED.length) {
    return true
  }
  return current.some((item, index) => {
    const seed = TEMPLATE_SEED[index]
    return item.suffix !== seed.suffix || item.alias !== seed.alias
  })
}

/** 只做校验与冲突探测，不改任何数据。界面拿它决定要不要让用户选冲突策略 */
export async function previewConfigPack(packPath: string): Promise<PackPreviewResult> {
  const { dir, manifest } = await extractAndVerify(packPath)
  try {
    const incoming = parseIncomingJks(fs.readFileSync(safeJoin(dir, JKS_NAME), 'utf8'))
    const byId = new Map(readJksFile().items.map((item) => [item.id, item]))
    const conflicts: PackConflict[] = []
    for (const item of incoming) {
      const existing = byId.get(item.id)
      if (existing && existing.sha256 !== item.sha256) {
        conflicts.push({
          id: item.id,
          displayName: item.displayName,
          existingSha256: existing.sha256,
          incomingSha256: item.sha256,
        })
      }
    }
    const relativePaths = Object.keys(manifest.files)
    return {
      canceled: false,
      packPath,
      exportedAt: manifest.exportedAt,
      jksCount: incoming.length,
      keystoreCount: relativePaths.filter((entry) => entry.startsWith(`${KEYSTORES_DIR}/`)).length,
      channelCount: relativePaths.filter((entry) => entry.startsWith(`${CHANNELS_DIR}/`)).length,
      hasTemplate: relativePaths.includes(TEMPLATE_NAME),
      templateDiffers: localTemplateDiffers(),
      conflicts,
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export interface PackImportInput {
  packPath: string
  conflictStrategy: ConflictStrategy
  /** 是否连模板一起导入；本机模板已改过时由界面明确询问后再置 true */
  overwriteTemplate: boolean
}

export async function importConfigPack(input: PackImportInput): Promise<PackImportResult> {
  const { dir, manifest } = await extractAndVerify(input.packPath)
  const notes: string[] = []
  try {
    const incoming = parseIncomingJks(fs.readFileSync(safeJoin(dir, JKS_NAME), 'utf8'))
    const current = readJksFile()
    const items = [...current.items]
    const byId = new Map(items.map((item) => [item.id, item]))
    const taken = new Set(byId.keys())

    let importedJks = 0
    let skipped = 0
    let overwritten = 0
    let renamed = 0
    const missingSources: string[] = []

    for (const item of incoming) {
      const existing = byId.get(item.id)

      if (existing && existing.sha256 === item.sha256) {
        skipped += 1
        notes.push(`${item.id}：本机已存在且内容相同，跳过`)
        continue
      }
      if (existing && input.conflictStrategy === 'skip') {
        skipped += 1
        notes.push(`${item.id}：本机已存在且内容不同，按选择跳过`)
        continue
      }

      let targetId = item.id
      let targetItem = item
      if (existing && input.conflictStrategy === 'keep-both') {
        targetId = allocateId(item.id, taken)
        targetItem = { ...item, id: targetId, displayName: `${item.displayName}（导入）` }
        renamed += 1
        notes.push(`${item.id}：本机已存在且内容不同，另存为 ${targetId}`)
      } else if (existing) {
        overwritten += 1
        notes.push(`${item.id}：本机已存在且内容不同，已覆盖`)
      }

      // 副本一律落到规范位置 keystores/<id>.jks，不沿用包里可能不一致的路径（R21）
      const keystoreRelative = keystoreRelativePath(targetId)
      copyInto(dir, item.keystoreFile, path.join(getKeystoresDir(), `${targetId}.jks`))

      const channelsRelative = `${CHANNELS_DIR}/${item.id}.json`
      if (manifest.files[channelsRelative] !== undefined) {
        const text = fs.readFileSync(safeJoin(dir, channelsRelative), 'utf8')
        const parsed = parseChannelConfig(text, `配置包里的 ${channelsRelative}`)
        writeChannels(targetId, {
          defaultExtraInfo: { app: targetItem.app },
          channelInfoList: parsed.channelInfoList,
        })
      }

      const normalized: JksItem = { ...targetItem, id: targetId, keystoreFile: keystoreRelative }
      /*
       * 只有「覆盖」才是就地替换已有条目。
       * 「保留两份」的新 id 与原 id 不同，必须**追加** —— 早先按 id 找不到就复用原位置，
       * 结果把原条目顶掉了（items 里只剩 a_2，a 消失）。两者的语义不同，不能合并成一个分支。
       */
      if (existing && input.conflictStrategy === 'overwrite') {
        const index = items.findIndex((entry) => entry.id === item.id)
        items[index] = normalized
      } else {
        items.push(normalized)
      }
      byId.set(targetId, normalized)
      taken.add(targetId)
      importedJks += 1

      if (normalized.sourcePath !== '' && !fs.existsSync(normalized.sourcePath)) {
        missingSources.push(targetId)
      }
    }

    writeJksFile({ version: JKS_FILE_VERSION, items })

    if (missingSources.length > 0) {
      notes.push(
        `这些条目的原文件位置在本机不存在（配置来自另一台机器），仅供显示：${missingSources.join('、')}`,
      )
    }

    let importedTemplate = false
    if (manifest.files[TEMPLATE_NAME] !== undefined && input.overwriteTemplate) {
      const text = fs.readFileSync(safeJoin(dir, TEMPLATE_NAME), 'utf8')
      const parsed = JSON.parse(text) as { suffixes?: unknown }
      const suffixes = Array.isArray(parsed.suffixes) ? parsed.suffixes : null
      const valid =
        suffixes !== null &&
        suffixes.every(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { suffix?: unknown }).suffix === 'string',
        )
      if (!valid) {
        notes.push('配置包里的 template.json 结构不符，模板未导入')
      } else {
        writeTemplate({
          version: 1,
          suffixes: (suffixes as { suffix: string; alias?: string }[]).map((entry) => ({
            suffix: entry.suffix,
            alias: typeof entry.alias === 'string' ? entry.alias : '',
          })),
        })
        importedTemplate = true
      }
    } else if (manifest.files[TEMPLATE_NAME] !== undefined) {
      notes.push('按选择未导入模板，本机模板保持不变')
    }

    return { importedJks, skipped, overwritten, renamed, importedTemplate, notes }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** 导出某个 jks 的渠道为 JSON，结构与 channelConfig.sample.json 一致 */
export function exportChannels(id: string, app: string, targetPath: string): number {
  const config = readChannels(id, app)
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return config.channelInfoList.length
}

/**
 * 导入渠道 JSON。
 * **原样复制** channelInfoList —— 渠道名与别名逐字保留，不做前缀替换（K1/R14）。
 */
export function importChannels(id: string, app: string, sourcePath: string): ChannelImportResult {
  const parsed = parseChannelConfig(fs.readFileSync(sourcePath, 'utf8'), '选择的文件')
  const notes: string[] = []
  if (parsed.app !== undefined && parsed.app !== app) {
    notes.push(
      `文件里的 defaultExtraInfo.app 是「${parsed.app}」，与本 jks 的「${app}」不同；按 jks 的值为准，文件里的未采用。`,
    )
  }
  const config = { defaultExtraInfo: { app }, channelInfoList: parsed.channelInfoList }
  writeChannels(id, config)
  return { config, count: config.channelInfoList.length, notes }
}

/**
 * 导出模板后缀表为 JSON，结构与 `data/template.json` 完全一致，
 * 用户改完可以用 `importTemplateJson` 套用成某个 jks 的渠道列表。
 */
export function exportTemplateJson(targetPath: string): { count: number; isDefault: boolean } {
  const template = readTemplate()
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8')
  return { count: template.suffixes.length, isDefault: !localTemplateDiffers() }
}

/**
 * 解析模板 JSON 成后缀表。
 *
 * 与 `parseChannelConfig` 一样刻意严格：结构不符就抛带原因的错。
 * 单独认出「这是渠道列表不是模板」这一种情况 —— 用户很容易拿错文件，
 * 直接告诉他该用哪个按钮，比抛一句「缺少 suffixes 数组」有用。
 */
function parseTemplateFile(text: string, sourceLabel = '文件'): TemplateSuffix[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${sourceLabel}不是合法的 JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${sourceLabel}的顶层必须是一个对象`)
  }

  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record.suffixes)) {
    if (Array.isArray(record.channelInfoList)) {
      throw new Error(`${sourceLabel}是渠道列表而不是模板，请用「导入 JSON」。`)
    }
    throw new Error(`${sourceLabel}缺少 suffixes 数组`)
  }

  return record.suffixes.map((raw, index) => {
    const position = `suffixes[${index}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`${position} 必须是对象`)
    }
    const entry = raw as Record<string, unknown>
    if (typeof entry.suffix !== 'string' || entry.suffix.trim() === '') {
      throw new Error(`${position} 缺少非空的 suffix`)
    }
    if (entry.alias !== undefined && typeof entry.alias !== 'string') {
      throw new Error(`${position} 的 alias 必须是字符串`)
    }
    const alias = typeof entry.alias === 'string' ? entry.alias.trim() : ''
    return { suffix: entry.suffix.trim(), alias }
  })
}

/**
 * 导入模板 JSON：把后缀表按前缀展开成渠道名，写进指定 jks 的渠道列表。
 *
 * **只动渠道列表，不回写模板本体** —— 这份 JSON 是给当前 jks 用的起点，
 * 不是「以后所有 jks 都套用」的新模板。要改模板本体请到「渠道模板」页。
 */
export function importTemplateJson(
  id: string,
  app: string,
  prefix: string,
  sourcePath: string,
): TemplateImportResult {
  const suffixes = parseTemplateFile(fs.readFileSync(sourcePath, 'utf8'), '选择的文件')
  const notes: string[] = []
  if (suffixes.length === 0) {
    notes.push('文件里的 suffixes 是空的，渠道列表会被清空。')
  }
  // 展开规则与「按模板生成」共用一份实现，避免两处算出不同的渠道名
  const config = buildChannelsFromTemplate(suffixes, prefix, app)
  writeChannels(id, config)
  return { config, count: config.channelInfoList.length, notes }
}
