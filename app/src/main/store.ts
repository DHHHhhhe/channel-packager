import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_SEED } from '../shared/constants/templateSeed'
import type {
  ChannelConfig,
  GroupFile,
  GroupItem,
  GroupMutation,
  GroupMutationResult,
  JksFile,
  StoreProblem,
  TemplateFile,
} from '../shared/types/store'
import { allocateId, toFileId } from '../shared/utils/ids'
import { getChannelsDir, getDataDir } from './paths'

export const JKS_FILE_VERSION = 2
export const TEMPLATE_FILE_VERSION = 1
export const GROUPS_FILE_VERSION = 1

const JKS_FILE_NAME = 'jks.json'
const TEMPLATE_FILE_NAME = 'template.json'
const GROUPS_FILE_NAME = 'groups.json'

/** 攒下这一轮读到的问题，由 IPC 层取走。同一个文件只报一次 */
const pendingProblems: StoreProblem[] = []

function noteProblem(problem: StoreProblem): void {
  if (pendingProblems.some((entry) => entry.path === problem.path)) {
    return
  }
  pendingProblems.push(problem)
}

/** 取走并清空攒下的读取问题。IPC 层在「读完一批」之后调用 */
export function drainStoreProblems(): StoreProblem[] {
  return pendingProblems.splice(0, pendingProblems.length)
}

/**
 * 坏文件先另存一份 `.broken` 再继续。
 * 只在还没有备份时复制 —— 反复坏掉时保留最早那份，也避免备份无限堆积。
 * 备份本身失败（例如磁盘满）不算致命，返回 undefined，照常报问题即可。
 */
function rescueBrokenFile(filePath: string): string | undefined {
  const backupPath = `${filePath}.broken`
  try {
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath)
    }
    return backupPath
  } catch {
    return undefined
  }
}

function makeProblem(label: string, filePath: string, reason: string): StoreProblem {
  const problem: StoreProblem = { label, path: filePath, reason }
  const backupPath = rescueBrokenFile(filePath)
  if (backupPath !== undefined) {
    problem.backupPath = backupPath
  }
  return problem
}

interface ReadOutcome<T> {
  value: T | null
  problem: StoreProblem | null
}

/**
 * 读 JSON，并把两种「读不到」分开：
 * - 文件不存在（ENOENT）不是问题，交给调用方给默认值；
 * - 文件在、却解析不了或读不出来，是问题 —— 必须带着路径报给用户，
 *   否则界面只会显示「已配置 0 个 jks」，看起来像配置整个丢了。
 *
 * 这里不抛异常：坏文件不该把应用卡在启动阶段。
 */
function readJson<T>(filePath: string, label: string): ReadOutcome<T> {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { value: null, problem: null }
    }
    return {
      value: null,
      problem: makeProblem(label, filePath, `读不出来（${code ?? '未知错误'}）`),
    }
  }

  try {
    return { value: JSON.parse(text) as T, problem: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { value: null, problem: makeProblem(label, filePath, `不是合法的 JSON（${detail}）`) }
  }
}

/** 先写临时文件再改名：中途崩溃不会把原文件截成半个 JSON */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmp, filePath)
}

export function jksFilePath(): string {
  return path.join(getDataDir(), JKS_FILE_NAME)
}

export function templateFilePath(): string {
  return path.join(getDataDir(), TEMPLATE_FILE_NAME)
}

/**
 * 分组索引与 channels/ 平级放在 data/ 根下，**不能放进 channels/**：
 * 导出用 listFiles(getChannelsDir()) 全量 stage，导入只按 channels/<id>.json 查，
 * 放进去会「导得出去、导不回来」。
 */
export function groupsFilePath(): string {
  return path.join(getDataDir(), GROUPS_FILE_NAME)
}

/** 渠道文件的键是**分组 id**（迁移来的分组直接复用原 jks id，所以老路径一字不变） */
export function channelsFilePath(id: string): string {
  return path.join(getChannelsDir(), `${id}.json`)
}

export function readJksFile(): JksFile {
  const filePath = jksFilePath()
  const { value, problem } = readJson<JksFile>(filePath, '签名文件列表')
  if (problem) {
    noteProblem(problem)
    return { version: JKS_FILE_VERSION, items: [] }
  }
  if (!value) {
    // 文件不存在：正常的「还没有」
    return { version: JKS_FILE_VERSION, items: [] }
  }
  if (!Array.isArray(value.items)) {
    noteProblem(makeProblem('签名文件列表', filePath, '结构不对：缺少 items 数组'))
    return { version: JKS_FILE_VERSION, items: [] }
  }
  return { version: JKS_FILE_VERSION, items: value.items }
}

export function writeJksFile(file: JksFile): void {
  writeJsonAtomic(jksFilePath(), { version: JKS_FILE_VERSION, items: file.items })
}

function seedTemplate(): TemplateFile {
  return { version: TEMPLATE_FILE_VERSION, suffixes: [...TEMPLATE_SEED] }
}

export function readTemplate(): TemplateFile {
  const filePath = templateFilePath()
  const { value, problem } = readJson<TemplateFile>(filePath, '渠道模板')
  if (problem) {
    // 坏了就**不落盘**：写种子等于顺手把用户那份模板删了
    noteProblem(problem)
    return seedTemplate()
  }
  if (!value) {
    // 首次启动：落一份种子，之后一律以 data/template.json 为准
    const seeded = seedTemplate()
    writeJsonAtomic(filePath, seeded)
    return seeded
  }
  if (!Array.isArray(value.suffixes)) {
    // 能解析但结构不对：同样保住原文件，只在内存里退回种子
    noteProblem(makeProblem('渠道模板', filePath, '结构不对：缺少 suffixes 数组'))
    return seedTemplate()
  }
  return { version: TEMPLATE_FILE_VERSION, suffixes: value.suffixes }
}

export function writeTemplate(template: TemplateFile): void {
  writeJsonAtomic(templateFilePath(), {
    version: TEMPLATE_FILE_VERSION,
    suffixes: template.suffixes,
  })
}

/** 渠道文件缺失时给一份空配置，app 名取分组（老数据里退回 jks 条目）上的值 */
export function readChannels(id: string, appName: string): ChannelConfig {
  const filePath = channelsFilePath(id)
  const empty: ChannelConfig = { defaultExtraInfo: { app: appName }, channelInfoList: [] }
  const { value, problem } = readJson<ChannelConfig>(filePath, `渠道列表（${id}）`)
  if (problem) {
    noteProblem(problem)
    return empty
  }
  if (!value) {
    // 这个 jks 还没建过渠道列表，是常态
    return empty
  }
  if (!Array.isArray(value.channelInfoList)) {
    noteProblem(makeProblem(`渠道列表（${id}）`, filePath, '结构不对：缺少 channelInfoList 数组'))
    return empty
  }
  return value
}

export function writeChannels(id: string, config: ChannelConfig): void {
  writeJsonAtomic(channelsFilePath(id), config)
}

/** 删掉某个分组的渠道文件。只由 applyGroupMutation 调用 —— 删 jks 不再级联删渠道（R4） */
export function deleteChannels(id: string): void {
  fs.rmSync(channelsFilePath(id), { force: true })
}

export function readGroups(): GroupFile {
  const filePath = groupsFilePath()
  const empty: GroupFile = { version: GROUPS_FILE_VERSION, items: [] }
  const { value, problem } = readJson<GroupFile>(filePath, '分组索引')
  if (problem) {
    noteProblem(problem)
    return empty
  }
  if (!value) {
    // 文件不存在：还没建过分组，等迁移或用户新建，不是问题
    return empty
  }
  if (!Array.isArray(value.items)) {
    noteProblem(makeProblem('分组索引', filePath, '结构不对：缺少 items 数组'))
    return empty
  }
  return { version: GROUPS_FILE_VERSION, items: value.items }
}

export function writeGroups(file: GroupFile): void {
  writeJsonAtomic(groupsFilePath(), { version: GROUPS_FILE_VERSION, items: file.items })
}

/**
 * 老数据迁移（R5 / R8）：`channels/<jksId>.json` 原地成为同名分组。
 *
 * - **一个文件都不删、不搬**：分组 id 就是原 jks id，渠道文件路径一字不变。
 * - 幂等判据是「groups.json 是否已含该 id」，重复启动不会重复建。
 * - 只对**渠道文件存在**的 jks 建分组，否则会给从没配过渠道的 jks 造一堆空分组。
 * - 反向不成立：channels/ 下的孤儿文件（jks 已删）不建分组，保留原地不动。
 */
export function migrateGroupsIfNeeded(): GroupFile {
  const groups = readGroups()
  const jks = readJksFile()
  const known = new Set(groups.items.map((item) => item.id))
  const now = new Date().toISOString()
  const added: GroupItem[] = []

  for (const item of jks.items) {
    if (known.has(item.id) || !fs.existsSync(channelsFilePath(item.id))) {
      continue
    }
    added.push({
      id: item.id,
      name: item.displayName,
      // 中文应用名是本次新增的概念，老数据里没有来源 —— 留空由用户补
      appLabel: '',
      app: item.app,
      createdAt: now,
      updatedAt: now,
    })
    known.add(item.id)
  }

  if (added.length === 0) {
    return groups
  }
  const migrated: GroupFile = { version: GROUPS_FILE_VERSION, items: [...groups.items, ...added] }
  writeGroups(migrated)
  return migrated
}

/**
 * 分组的增改删。渠道条目本身在 `channels/<id>.json`，由「渠道配置」页单独读写；
 * 这里只管索引，外加删除时一并清掉那个文件（否则同 id 重建会读到上一份列表）。
 */
export function applyGroupMutation(mutation: GroupMutation): GroupMutationResult {
  const file = readGroups()
  const now = new Date().toISOString()

  if (mutation.action === 'add') {
    const taken = new Set(file.items.map((item) => item.id))
    // 分组没有源文件名可借，id 从英文名推导；英文名也空时退到分组名，最后兜到 group。
    // 调用方指定了 id（新建 jks 顺手建分组）就优先用它 —— 渠道文件路径依赖它
    const requested = toFileId(mutation.id ?? '', '')
    const base =
      requested !== ''
        ? requested
        : toFileId(mutation.app, toFileId(mutation.name, 'group'))
    const id = allocateId(base, taken)
    let name = mutation.name.trim()
    if (name === '') {
      // Q4：分组名默认取应用名。界面会预填，这里只是兜底
      name = mutation.appLabel.trim() !== '' ? mutation.appLabel.trim() : mutation.app.trim()
    }
    if (name === '') {
      name = id
    }
    const item: GroupItem = {
      id,
      name,
      appLabel: mutation.appLabel,
      app: mutation.app,
      createdAt: now,
      updatedAt: now,
    }
    file.items.push(item)
    writeGroups(file)
    return { status: 'added', items: file.items, item }
  }

  if (mutation.action === 'update') {
    const index = file.items.findIndex((item) => item.id === mutation.item.id)
    if (index < 0) {
      throw new Error(`找不到分组：${mutation.item.id}`)
    }
    const updated: GroupItem = { ...mutation.item, updatedAt: now }
    file.items[index] = updated
    writeGroups(file)
    return { status: 'updated', items: file.items, item: updated }
  }

  if (!file.items.some((item) => item.id === mutation.id)) {
    throw new Error(`找不到分组：${mutation.id}`)
  }
  file.items = file.items.filter((item) => item.id !== mutation.id)
  writeGroups(file)
  deleteChannels(mutation.id)
  return { status: 'removed', items: file.items }
}
