import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { TEMPLATE_SEED } from '../shared/constants/templateSeed'
import type { ChannelEntry, GroupFile, GroupItem, JksItem, TemplateSuffix } from '../shared/types/store'
import {
  PACK_FORMAT,
  PACK_VERSION,
  type ChannelListPreview,
  type ConflictStrategy,
  type PackConflict,
  type PackExportResult,
  type PackImportResult,
  type PackManifest,
  type PackPreviewResult,
} from '../shared/types/pack'
import { buildChannelsFromTemplate, parseChannelConfig } from '../shared/utils/channels'
import { allocateId } from '../shared/utils/ids'
import { keystoreRelativePath, sha256File } from './keystore'
import { getChannelsDir, getKeystoresDir } from './paths'
import { runProcess, tailLines } from './proc'
import { resolveRuntimeComponentPath } from './runtime'
import {
  JKS_FILE_VERSION,
  groupsFilePath,
  jksFilePath,
  readGroups,
  readJksFile,
  readTemplate,
  templateFilePath,
  writeChannels,
  writeGroups,
  writeJksFile,
  writeTemplate,
} from './store'

const MANIFEST_NAME = 'manifest.json'
const JKS_NAME = 'jks.json'
const TEMPLATE_NAME = 'template.json'
const KEYSTORES_DIR = 'keystores'
const CHANNELS_DIR = 'channels'
/** 与 store.ts 的 GROUPS_FILE_NAME 必须一致：包内路径是导入导出两侧的契约 */
const GROUPS_NAME = 'groups.json'

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
    // 旧版导出的包没有这个字段，按「含凭据」处理
    credentialFree: record.credentialFree === true,
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
  /**
   * 是否把签名凭据（jks 副本与 jks.json 里的条目）打进去。
   *
   * 置 false 时包内只有 template.json 与一份空的 jks.json，给同事当初始包用：
   * 对方导入后拿到渠道模板，自己再新增 jks —— 私钥与明文密码不出本机。
   */
  includeCredentials: boolean
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
    stage(TEMPLATE_NAME, templateFilePath())

    if (input.includeCredentials) {
      stage(JKS_NAME, jksFilePath())

      for (const name of listFiles(getKeystoresDir())) {
        stage(`${KEYSTORES_DIR}/${name}`, path.join(getKeystoresDir(), name))
      }
      for (const name of listFiles(getChannelsDir())) {
        stage(`${CHANNELS_DIR}/${name}`, path.join(getChannelsDir(), name))
      }
      /*
       * 分组索引必须跟 channels/ 成对走：渠道文件的归属写在它里面。
       * 只导渠道不导索引，对方拿到的是一堆没主的文件 —— 导入侧也就无从还原
       * （会退回「每个 jks 一个分组」的老包路径，等于分组名与应用名全丢了）。
       */
      if (fs.existsSync(groupsFilePath())) {
        stage(GROUPS_NAME, groupsFilePath())
      }
    } else {
      /*
       * 不含凭据时仍要放一份**空的** jks.json：导入侧第一步就是读它，
       * 缺文件会被判成「这不是本工具导出的配置包」。空列表则一路走空循环，
       * 对方的既有 jks 一条都不会动（importConfigPack 是在本机列表上追加）。
       * 渠道列表与分组索引也一并省掉：这份包只用来「拿一份渠道模板」，
       * 分组是对方自己的东西，不该被一份空包动到。
       */
      const emptyJks = `${JSON.stringify({ version: JKS_FILE_VERSION, items: [] }, null, 2)}\n`
      const target = safeJoin(staging, JKS_NAME)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, emptyJks, 'utf8')
      files[JKS_NAME] = createHash('sha256').update(emptyJks, 'utf8').digest('hex')
    }

    const manifest: PackManifest = {
      format: PACK_FORMAT,
      version: PACK_VERSION,
      exportedAt: new Date().toISOString(),
      jksCount: input.includeCredentials ? readJksFile().items.length : 0,
      credentialFree: !input.includeCredentials,
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
      credentialFree: !input.includeCredentials,
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
      credentialFree: manifest.credentialFree,
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

/**
 * 还原配置包里的分组索引（含各分组自己的渠道列表），返回包内分组 id → 本机分组 id 的映射。
 *
 * 分组与 jks 没有绑定关系（A′），所以这一段**独立于 jks 的冲突处理**：
 * jks 的「跳过 / 覆盖 / 保留两份」不会影响分组；分组一律**追加**，id 撞车就另分一个
 * —— 就地顶掉本机同名分组，等于把人家的渠道列表换了，那是数据丢失而不是冲突处理。
 *
 * 包内没有 groups.json（老包）时返回空映射，由调用方走「每个 jks 一个分组」那条老路。
 */
function restorePackedGroups(
  dir: string,
  manifest: PackManifest,
  notes: string[],
  groupFile: GroupFile,
  taken: Set<string>,
): { hasIndex: boolean; changed: boolean } {
  if (manifest.files[GROUPS_NAME] === undefined) {
    return { hasIndex: false, changed: false }
  }

  const text = fs.readFileSync(safeJoin(dir, GROUPS_NAME), 'utf8')
  let parsed: { items?: unknown }
  try {
    parsed = JSON.parse(text) as { items?: unknown }
  } catch {
    notes.push('配置包里的 groups.json 不是合法 JSON，分组未导入')
    return { hasIndex: false, changed: false }
  }
  const incoming = Array.isArray(parsed.items) ? parsed.items : null
  if (incoming === null) {
    notes.push('配置包里的 groups.json 结构不符（缺少 items 数组），分组未导入')
    return { hasIndex: false, changed: false }
  }

  const now = new Date().toISOString()
  let imported = 0

  for (const raw of incoming) {
    const entry = raw as Partial<GroupItem>
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      continue
    }
    const packId = entry.id
    const id = allocateId(packId, taken)
    const app = typeof entry.app === 'string' ? entry.app : ''
    const appLabel = typeof entry.appLabel === 'string' ? entry.appLabel : ''
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : ''
    // 名字缺了就退回中文应用名、再退回英文名 —— 与 applyGroupMutation 的兜底同序
    const name = rawName !== '' ? rawName : appLabel.trim() !== '' ? appLabel.trim() : app

    groupFile.items.push({
      id,
      name: name.trim() === '' ? id : name,
      appLabel,
      app,
      createdAt: now,
      updatedAt: now,
    })
    taken.add(id)
    imported += 1

    const channelsRelative = `${CHANNELS_DIR}/${packId}.json`
    if (manifest.files[channelsRelative] !== undefined) {
      const channelsText = fs.readFileSync(safeJoin(dir, channelsRelative), 'utf8')
      const channels = parseChannelConfig(channelsText, `配置包里的 ${channelsRelative}`)
      // defaultExtraInfo.app 归分组所有：用索引里的值写回，不信渠道文件里那份（R1）
      writeChannels(id, { defaultExtraInfo: { app }, channelInfoList: channels.channelInfoList })
    }
  }

  if (imported > 0) {
    notes.push(`导入了 ${imported} 个分组`)
  }

  // 有渠道文件却没进索引的，是包里的孤儿 —— 说出来，别让它悄悄消失
  const orphans = Object.keys(manifest.files).filter(
    (relative) =>
      relative.startsWith(`${CHANNELS_DIR}/`) &&
      !incoming.some(
        (raw) => `${CHANNELS_DIR}/${(raw as Partial<GroupItem>).id ?? ''}.json` === relative,
      ),
  )
  if (orphans.length > 0) {
    notes.push(`配置包里有 ${orphans.length} 份渠道列表没有对应的分组，已跳过`)
  }

  return { hasIndex: true, changed: imported > 0 }
}

export async function importConfigPack(input: PackImportInput): Promise<PackImportResult> {
  const { dir, manifest } = await extractAndVerify(input.packPath)
  const notes: string[] = []
  if (manifest.credentialFree) {
    notes.push('这份包不含签名凭据（只有渠道模板），签名文件需自行新增')
  }
  try {
    const incoming = parseIncomingJks(fs.readFileSync(safeJoin(dir, JKS_NAME), 'utf8'))
    const current = readJksFile()
    const items = [...current.items]
    const byId = new Map(items.map((item) => [item.id, item]))
    const taken = new Set(byId.keys())

    // 分组索引：新包（带 groups.json）一次还原；老包在下面按 jks 逐个补建
    const groupFile = readGroups()
    const takenGroups = new Set(groupFile.items.map((entry) => entry.id))
    const restored = restorePackedGroups(dir, manifest, notes, groupFile, takenGroups)
    let groupsChanged = restored.changed
    if (restored.changed) {
      /*
       * 新包的分组在 restorePackedGroups 里就已经把渠道文件写下去了，
       * 索引必须同时落地 —— 否则下面 jks 那圈一旦抛错，留下的渠道文件没人认领。
       * （结尾还会再写一次，把老包补建的分组一起带上；原子写，重复写无副作用。）
       */
      writeGroups(groupFile)
    }

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

      /*
       * 渠道列表跟着**分组**走（R1），不再挂在 jks 上。
       *
       * 新包的分组（连同各自的渠道）已经在上面的 restorePackedGroups 里还原过了，
       * 这里不再碰 —— 否则会按 jks id 又写出一份没人认领的渠道文件。
       *
       * 老包（version=1，没有分组索引）沿用「每个 jks 一个分组」的还原方式，
       * 判据与 migrateGroupsIfNeeded 一致：已经有同 id 分组就并进去，不重复建。
       */
      if (!restored.hasIndex) {
        const channelsRelative = `${CHANNELS_DIR}/${item.id}.json`
        if (manifest.files[channelsRelative] !== undefined) {
          const text = fs.readFileSync(safeJoin(dir, channelsRelative), 'utf8')
          const parsed = parseChannelConfig(text, `配置包里的 ${channelsRelative}`)
          if (!takenGroups.has(targetId)) {
            groupFile.items.push({
              id: targetId,
              name: targetItem.displayName,
              // 中文应用名是本次新增的概念，老包里没有来源 —— 留空由用户补
              appLabel: '',
              app: targetItem.app,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            takenGroups.add(targetId)
            groupsChanged = true
          }
          writeChannels(targetId, {
            defaultExtraInfo: { app: targetItem.app },
            channelInfoList: parsed.channelInfoList,
          })
        }
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

    if (groupsChanged) {
      writeGroups(groupFile)
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

/**
 * 导出渠道 JSON。
 *
 * 写的是**渲染层传进来的列表**，不是磁盘上那份 ——
 * 「导入 JSON」只把条目填进界面、由用户点「保存渠道列表」才落盘，
 * 若这里仍旧读文件，用户刚导入还没保存时导出的会是旧内容，两边对不上。
 */
export function exportChannels(
  app: string,
  targetPath: string,
  channelInfoList: ChannelEntry[],
): number {
  const config = { defaultExtraInfo: { app }, channelInfoList }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return channelInfoList.length
}

/**
 * 只读解析：把文件里的渠道条目读出来，不落盘。
 * 用户看过、改过、确认之后，条目由渲染层合并进界面列表，
 * 落盘统一走「保存渠道列表」。
 *
 * **原样复制** channelInfoList —— 渠道名与别名逐字保留，不做前缀替换（K1/R14）。
 */
export function previewChannels(app: string, sourcePath: string): ChannelListPreview {
  const parsed = parseChannelConfig(fs.readFileSync(sourcePath, 'utf8'), '选择的文件')
  const notes: string[] = []
  if (parsed.app !== undefined && parsed.app !== app) {
    notes.push(
      `文件里的 defaultExtraInfo.app 是「${parsed.app}」，与本分组的「${app}」不同；按分组的值来，文件里的未采用。`,
    )
  }
  return {
    fileName: path.basename(sourcePath),
    channels: parsed.channelInfoList,
    count: parsed.channelInfoList.length,
    notes,
  }
}

/** 模板为空时「导出示例 JSON」用的兜底后缀，保证导出的文件永远是可用的结构 */
const SAMPLE_SUFFIXES: TemplateSuffix[] = [
  { suffix: 'gf', alias: '官方' },
  { suffix: 'yyb', alias: '应用宝' },
]

/**
 * 导出「示例渠道 JSON」—— 给还没有渠道列表的用户一份可以直接改的起点。
 *
 * 条目按「渠道模板」页的模板 + 前缀展开（与「按模板生成」共用
 * `buildChannelsFromTemplate`，避免两处算出不同的渠道名）；模板为空时退回两条兜底示例。
 *
 * 顶层多一个 `_说明` 字段：`parseChannelConfig` 只读 `channelInfoList` 与
 * `defaultExtraInfo`，多余字段会被忽略，所以它纯粹是写给用户看的注释。
 */
export function exportSampleChannels(
  app: string,
  prefix: string,
  targetPath: string,
): { count: number; fromTemplate: boolean } {
  const suffixes = readTemplate().suffixes
  const fromTemplate = suffixes.length > 0
  const config = buildChannelsFromTemplate(fromTemplate ? suffixes : SAMPLE_SUFFIXES, prefix, app)
  const payload = {
    _说明:
      '这是示例文件。改好 channelInfoList 后用「导入 JSON」读回来；defaultExtraInfo.app 会按当前分组的值覆盖。',
    ...config,
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { count: config.channelInfoList.length, fromTemplate }
}
