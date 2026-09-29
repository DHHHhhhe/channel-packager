/** 一个 jks 条目。字段含义见 design.md「数据模型」 */
export interface JksItem {
  /** 稳定标识，默认取 jks 文件名去扩展名；channels/<id>.json 以它命名 */
  id: string
  displayName: string
  /** 相对 data/ 的副本路径 —— 签名与凭据校验唯一使用的路径 */
  keystoreFile: string
  /** 原文件位置，仅供显示与「从原文件重新导入」，不参与签名 */
  sourcePath: string
  /** 导入时的指纹，用于刷新时比对 */
  sha256: string
  fileSize: number
  alias: string
  storePassword: string
  /** 写入 walle 的 defaultExtraInfo.app */
  app: string
  /** derived = 来自规律推导；manual = 用户手工填过。仅用于界面提示 */
  credentialSource: 'derived' | 'manual'
  importedAt: string
}

export interface JksFile {
  version: number
  items: JksItem[]
}

/** 模板里的一条：渠道后缀 + 显示别名 */
export interface TemplateSuffix {
  suffix: string
  alias: string
}

export interface TemplateFile {
  version: number
  suffixes: TemplateSuffix[]
}

/**
 * 渠道条目。与工作目录的 channelConfig.sample.json 严格同构，
 * 这样现有配置能直接导入、本应用导出的也能直接给 walle 的 batch2 -f 用。
 */
export interface ChannelEntry {
  channel: string
  alias?: string
}

export interface ChannelConfig {
  defaultExtraInfo: { app: string }
  channelInfoList: ChannelEntry[]
}

/** 应用启动时一次性取回的存储快照，省掉多次往返 */
export interface StoreSnapshot {
  jks: JksFile
  template: TemplateFile
  dataDir: string
  /** data/ 不可写、已回退到 userData 时为 true，界面需要明示 */
  usedFallback: boolean
}

/** store:saveJks 的请求，一个通道承载增改删三种动作 */
export type JksMutation =
  | {
      action: 'add'
      sourcePath: string
      displayName?: string
      alias?: string
      storePassword?: string
      app?: string
    }
  | { action: 'update'; item: JksItem }
  | { action: 'remove'; id: string }

export interface JksMutationResult {
  /**
   * added    = 已复制副本并入库
   * duplicate= 同 id 且 SHA256 相同，已存在，跳过
   * updated / removed = 完成
   */
  status: 'added' | 'duplicate' | 'updated' | 'removed'
  /** 操作后的完整列表，界面直接替换即可 */
  items: JksItem[]
  /** add 成功时返回新条目，便于界面高亮 */
  item?: JksItem
  /** duplicate 等情况下给用户看的原因 */
  message?: string
}

/** 从原文件重新导入的比对结果，不自动同步 */
export type RefreshStatus = 'unchanged' | 'changed' | 'source-unavailable'

export interface RefreshResult {
  status: RefreshStatus
  /** changed 时给出源文件当前指纹，供用户确认是否覆盖副本 */
  sourceSha256?: string
  sourceFileSize?: number
  message?: string
}

/**
 * 凭据校验结果。
 * `ok` 为 true 的语义是「口令正确，且能确定唯一可用的别名」——
 * 口令对但库里有多个条目、又对不上用户填的别名时，仍然算不通过，需要用户指定。
 */
export interface CredentialVerifyResult {
  ok: boolean
  /** 确定下来的别名，ok 为 true 时才有值 */
  alias?: string
  /** 库中实际存在的全部别名，供界面提示与选择 */
  aliases: string[]
  /** 给用户看的原因或提示 */
  message?: string
}
