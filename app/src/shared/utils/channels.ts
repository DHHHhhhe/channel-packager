import type { ChannelConfig, ChannelEntry, TemplateSuffix } from '../types/store'

/**
 * 套用模板生成某个 jks 的渠道列表。
 * `channel = <前缀> + "_" + suffix`；前缀为空时退化为 `channel = suffix`。
 * 返回的是全新对象，与模板无引用关系 —— 之后增删改副本都不会动到模板（K1）。
 */
export function buildChannelsFromTemplate(
  suffixes: readonly TemplateSuffix[],
  prefix: string,
  app: string,
): ChannelConfig {
  const trimmedPrefix = prefix.trim()
  return {
    defaultExtraInfo: { app },
    channelInfoList: suffixes.map((item) => {
      const channel = trimmedPrefix ? `${trimmedPrefix}_${item.suffix}` : item.suffix
      const alias = item.alias.trim()
      return alias ? { channel, alias } : { channel }
    }),
  }
}

/**
 * 解析结果。
 * `app` 可能没有 —— 它属于 jks 自己的配置，调用方用条目上的 app 补齐，
 * 所以这里不做「补个空字符串」这种会污染数据的兜底。
 */
export interface ParsedChannelConfig {
  app?: string
  channelInfoList: ChannelEntry[]
}

/**
 * 解析外部 JSON 成渠道配置，结构与 `channelConfig.sample.json` 一致。
 *
 * 刻意严格：结构不符就抛带原因的错，不静默兜底。静默把一份坏文件读成空列表，
 * 用户会以为「导入成功但渠道没了」，那比直接报错难查得多。
 */
export function parseChannelConfig(text: string, sourceLabel = '文件'): ParsedChannelConfig {
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
  if (!Array.isArray(record.channelInfoList)) {
    throw new Error(`${sourceLabel}缺少 channelInfoList 数组`)
  }

  const channelInfoList = record.channelInfoList.map((raw, index) => {
    const position = `channelInfoList[${index}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`${position} 必须是对象`)
    }
    const entry = raw as Record<string, unknown>
    if (typeof entry.channel !== 'string' || entry.channel.trim() === '') {
      throw new Error(`${position} 缺少非空的 channel`)
    }
    if (entry.alias !== undefined && typeof entry.alias !== 'string') {
      throw new Error(`${position} 的 alias 必须是字符串`)
    }
    const alias = typeof entry.alias === 'string' ? entry.alias.trim() : ''
    return alias ? { channel: entry.channel.trim(), alias } : { channel: entry.channel.trim() }
  })

  const extra = record.defaultExtraInfo
  const app =
    typeof extra === 'object' && extra !== null && typeof (extra as Record<string, unknown>).app === 'string'
      ? ((extra as Record<string, unknown>).app as string)
      : undefined

  return app !== undefined ? { app, channelInfoList } : { channelInfoList }
}
