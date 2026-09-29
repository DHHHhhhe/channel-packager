import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_SEED } from '../shared/constants/templateSeed'
import type { ChannelConfig, JksFile, TemplateFile } from '../shared/types/store'
import { getChannelsDir, getDataDir } from './paths'

export const JKS_FILE_VERSION = 2
export const TEMPLATE_FILE_VERSION = 1

const JKS_FILE_NAME = 'jks.json'
const TEMPLATE_FILE_NAME = 'template.json'

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    // 文件不存在、被截断、JSON 坏掉都走同一路径：当作「还没有」，由调用方给默认值。
    // 这里不抛异常，是为了让坏文件不至于把应用卡在启动阶段。
    return null
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

export function channelsFilePath(id: string): string {
  return path.join(getChannelsDir(), `${id}.json`)
}

export function readJksFile(): JksFile {
  const parsed = readJson<JksFile>(jksFilePath())
  if (!parsed || !Array.isArray(parsed.items)) {
    return { version: JKS_FILE_VERSION, items: [] }
  }
  return { version: JKS_FILE_VERSION, items: parsed.items }
}

export function writeJksFile(file: JksFile): void {
  writeJsonAtomic(jksFilePath(), { version: JKS_FILE_VERSION, items: file.items })
}

export function readTemplate(): TemplateFile {
  const parsed = readJson<TemplateFile>(templateFilePath())
  if (!parsed || !Array.isArray(parsed.suffixes)) {
    // 首次启动：落一份种子，之后一律以 data/template.json 为准
    const seeded: TemplateFile = { version: TEMPLATE_FILE_VERSION, suffixes: [...TEMPLATE_SEED] }
    writeJsonAtomic(templateFilePath(), seeded)
    return seeded
  }
  return { version: TEMPLATE_FILE_VERSION, suffixes: parsed.suffixes }
}

export function writeTemplate(template: TemplateFile): void {
  writeJsonAtomic(templateFilePath(), {
    version: TEMPLATE_FILE_VERSION,
    suffixes: template.suffixes,
  })
}

/** 渠道文件缺失时给一份空配置，app 名取条目上的值 */
export function readChannels(id: string, appName: string): ChannelConfig {
  const parsed = readJson<ChannelConfig>(channelsFilePath(id))
  if (!parsed || !Array.isArray(parsed.channelInfoList)) {
    return { defaultExtraInfo: { app: appName }, channelInfoList: [] }
  }
  return parsed
}

export function writeChannels(id: string, config: ChannelConfig): void {
  writeJsonAtomic(channelsFilePath(id), config)
}

export function deleteChannels(id: string): void {
  fs.rmSync(channelsFilePath(id), { force: true })
}
