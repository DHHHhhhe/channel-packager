import type { ChannelConfig, TemplateSuffix } from '../types/store'

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
