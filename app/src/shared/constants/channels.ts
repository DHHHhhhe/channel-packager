/**
 * IPC 通道名的唯一来源。主进程注册与 preload 调用都从这里取，
 * 避免两边各写一遍字符串导致拼错。
 */
export const IPC_CHANNELS = {
  runtimeCheck: 'runtime:check',

  storeLoad: 'store:load',
  storeSaveJks: 'store:saveJks',
  jksRefreshFromSource: 'jks:refreshFromSource',

  storeGetChannels: 'store:getChannels',
  storeSaveChannels: 'store:saveChannels',
  storeSaveTemplate: 'store:saveTemplate',

  channelsImport: 'channels:import',
  channelsExport: 'channels:export',

  /** 导出模板后缀表为 JSON，供用户改完再导回渠道列表 */
  templateExport: 'template:export',
  /** 读模板后缀表，按前缀展开成渠道名，写进指定 jks 的渠道列表 */
  templateImport: 'template:import',

  credVerify: 'cred:verify',

  taskRun: 'task:run',
  taskProgress: 'task:progress',

  walleShow: 'walle:show',

  packExport: 'pack:export',
  /** 选包 + 校验 + 探测冲突，只读不改 */
  packImport: 'pack:import',
  /** 用户确认冲突策略后真正落盘 */
  packImportApply: 'pack:importApply',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
