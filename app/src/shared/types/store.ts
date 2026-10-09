/** 一个 jks 条目。字段含义见 design.md「数据模型」 */
export interface JksItem {
  /** 稳定标识，默认取 jks 文件名去扩展名 */
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
  /** derived = 来自规律推导；manual = 用户手工填过。仅用于界面提示 */
  credentialSource: 'derived' | 'manual'
  importedAt: string
}

export interface JksFile {
  version: number
  items: JksItem[]
}

/**
 * 一个渠道分组（R1）。渠道列表的归属从这里取，与 jks 彻底解耦 ——
 * 拿不到私钥的人也能建分组、配渠道。
 *
 * 索引存在 data/groups.json，条目本身存在 channels/<id>.json。
 */
export interface GroupItem {
  /** 稳定标识；channels/<id>.json 以它命名。迁移来的分组直接复用原 jks id */
  id: string
  /** 分组名，给人认。新建时默认自动取 appLabel，可改 */
  name: string
  /** 应用名（中文显示名，如「沐爱」）。**只给人看，不写进包** */
  appLabel: string
  createdAt: string
  updatedAt: string
}

export interface GroupFile {
  version: number
  items: GroupItem[]
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

/**
 * 一个分组的渠道列表，存在 data/channels/<分组 id>.json。
 *
 * 只存渠道条目：walle 的 `defaultExtraInfo` 是可选的额外信息，本工具不再写它
 * （应用身份由 `applicationId` 决定，不需要在渠道里再放一份）。
 * 解析外部 JSON 时仍容忍文件里带 `defaultExtraInfo`，读进来直接忽略。
 */
export interface ChannelConfig {
  channelInfoList: ChannelEntry[]
}

/**
 * 一个「文件在、但读不出来」的配置文件。
 * 文件不存在不算问题 —— 那是「还没有」，不是「坏了」。
 */
export interface StoreProblem {
  /** 给用户看的角色名，例如「签名文件列表」「渠道列表（xklinai）」 */
  label: string
  /** 绝对路径，界面要显示出来，用户才能自己去修 */
  path: string
  /** 失败原因：JSON 解析错误原文，或系统错误码 */
  reason: string
  /** 坏文件被另存到这里（只备份最早那份）；备份不成功时为 undefined */
  backupPath?: string
}

/** 应用启动时一次性取回的存储快照，省掉多次往返 */
export interface StoreSnapshot {
  jks: JksFile
  /** 分组索引。读之前已经跑过老数据迁移，所以这里一定是迁移后的结果 */
  groups: GroupFile
  template: TemplateFile
  dataDir: string
  /** data/ 不可写、已回退到 userData 时为 true，界面需要明示 */
  usedFallback: boolean
  /** 这一轮读到的坏文件。空数组表示都正常 */
  problems: StoreProblem[]
}

/** store:saveJks 的请求，一个通道承载增改删三种动作 */
export type JksMutation =
  | {
      action: 'add'
      sourcePath: string
      displayName?: string
      alias?: string
      storePassword?: string
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

/** store:saveGroup 的请求，与 JksMutation 同构：一个通道承载增改删 */
export type GroupMutation =
  | {
      action: 'add'
      name: string
      appLabel: string
      /**
       * 指定分组 id。只有「新建签名文件时顺手把渠道也配好」那条路会传 ——
       * 它要沿用签名文件的 id，渠道文件才落在 channels/<签名文件 id>.json。
       * 不传就按分组名推导，与用户手建分组一致。
       */
      id?: string
    }
  | { action: 'update'; item: GroupItem }
  | { action: 'remove'; id: string }

export interface GroupMutationResult {
  status: 'added' | 'updated' | 'removed'
  /** 操作后的完整列表，界面直接替换即可 */
  items: GroupItem[]
  /** add 成功时返回新条目，便于界面选中它 */
  item?: GroupItem
}

/**
 * 从原文件重新导入的结果。
 * 比对（refreshFromSource）不自动同步，只有 synced 是用户点了「刷新副本」之后的结果。
 */
export type RefreshStatus = 'unchanged' | 'changed' | 'source-unavailable' | 'synced'

export interface RefreshResult {
  status: RefreshStatus
  /** changed / synced 时给出原文件当前指纹：changed 供用户确认，synced 是刷新后的新副本 */
  sourceSha256?: string
  sourceFileSize?: number
  message?: string
}

/**
 * 校验失败时最该被检查的那一项，供界面把对应字段标红。
 * 由主进程判定 —— 界面不该去猜「口令不正确」这句话里有没有「口令」两个字。
 */
export type CredentialField = 'keystore' | 'alias' | 'password'

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
  /** ok 为 false 时建议重点检查的字段 */
  field?: CredentialField
}
