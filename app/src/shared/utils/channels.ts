import type { ChannelConfig, TemplateSuffix } from '../types/store'

/**
 * 套用模板生成某个分组的渠道列表。
 * `channel = <前缀> + "_" + suffix`；前缀为空时退化为 `channel = suffix`。
 * 返回的是全新对象，与模板无引用关系 —— 之后增删改副本都不会动到模板（K1）。
 */
export function buildChannelsFromTemplate(
  suffixes: readonly TemplateSuffix[],
  prefix: string,
): ChannelConfig {
  const trimmedPrefix = prefix.trim()
  return {
    channelInfoList: suffixes.map((item) => {
      const channel = trimmedPrefix ? `${trimmedPrefix}_${item.suffix}` : item.suffix
      const alias = item.alias.trim()
      return alias ? { channel, alias } : { channel }
    }),
  }
}

/**
 * 解析外部 JSON 成渠道配置，结构与 `channelConfig.sample.json` 一致。
 *
 * 刻意严格：结构不符就抛带原因的错，不静默兜底。静默把一份坏文件读成空列表，
 * 用户会以为「导入成功但渠道没了」，那比直接报错难查得多。
 *
 * 文件里带 `defaultExtraInfo` 是允许的（老配置与老版本导出的都有），
 * 读进来直接丢掉 —— 本工具不再写这个字段。
 */
/**
 * 把 JSON.parse 的报错翻译成「第几行第几列」。
 *
 * 只说「不是合法的 JSON」等于没说：几百行的文件里用户不知道该改哪儿。
 * 新一点的 V8 直接在消息末尾带 `(line 42 column 7)`，老版本只给字符位置，
 * 那就按字符位置自己数一遍行与列。
 */
function describeJsonError(error: unknown, text: string): string {
  const message = error instanceof Error ? error.message : ''
  const located = /\(line (\d+) column (\d+)\)/.exec(message)
  if (located) {
    return `（第 ${located[1]} 行第 ${located[2]} 列附近）`
  }
  const at = /position (\d+)/.exec(message)
  if (at) {
    const offset = Number(at[1])
    const before = text.slice(0, offset)
    const line = before.split(/\r?\n/).length
    const column = offset - before.lastIndexOf('\n')
    return `（第 ${line} 行第 ${column} 列附近）`
  }
  if (/end of JSON input|Unexpected end/i.test(message)) {
    return '（文件像是少了一截，检查一下括号有没有配对）'
  }
  return ''
}

export function parseChannelConfig(text: string, sourceLabel = '文件'): ChannelConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${sourceLabel}不是合法的 JSON${describeJsonError(error, text)}`)
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

  return { channelInfoList }
}