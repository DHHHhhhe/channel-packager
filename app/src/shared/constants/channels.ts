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

  credVerify: 'cred:verify',

  taskRun: 'task:run',
  taskProgress: 'task:progress',

  walleShow: 'walle:show',

  packExport: 'pack:export',
  packImport: 'pack:import',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
