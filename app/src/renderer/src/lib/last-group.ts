/**
 * 出包页「上次用过的分组」。
 *
 * 分组与 jks 之间刻意没有任何绑定字段（A′）：同一个 jks 配几套渠道、同一套渠道换几个
 * jks 签名，都是常见动作，绑死了反而要先改配置。但每次都从头挑一遍分组也很烦，
 * 所以把「上次用的那个」记在渲染层本地 —— 它是界面偏好，不是数据：
 * 丢了只是回到默认的第一个分组，出包结果不受影响。
 *
 * 键按签名身份分（每个 jks 一份，不用 jks 时共用 NO_JKS_KEY），
 * 这样换回某个 jks 就能回到它上次配的那套渠道。
 */

const PREFIX = 'channelpack.pack.lastGroup.'

/** 不用 jks（只写渠道）时也要记一份，用这个键位与真实 jks 区分开 */
export const NO_JKS_KEY = '__none__'

export function readLastGroup(signKey: string): string {
  try {
    return window.localStorage.getItem(PREFIX + signKey) ?? ''
  } catch {
    // localStorage 被禁或写满时会抛；读不到就按「没有记过」处理
    return ''
  }
}

export function writeLastGroup(signKey: string, groupId: string): void {
  try {
    if (groupId === '') {
      window.localStorage.removeItem(PREFIX + signKey)
      return
    }
    window.localStorage.setItem(PREFIX + signKey, groupId)
  } catch {
    // 记不住不影响出包，静默跳过
  }
}
