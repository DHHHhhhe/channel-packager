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
  /** 分组索引的增改删。渠道条目本身仍走 store:saveChannels */
  storeSaveGroup: 'store:saveGroup',
  storeSaveTemplate: 'store:saveTemplate',
  /** 取走并清空「读到坏文件」的记录；读不到的文件不存在时不算坏 */
  storeTakeProblems: 'store:takeProblems',

  /** 选文件 + 解析，只读；返回文件里的条目供用户预览与编辑 */
  channelsImport: 'channels:import',
  /** 导出渠道 JSON：导的是**界面上**的列表，含尚未保存的修改 */
  channelsExport: 'channels:export',
  /** 渠道列表为空时导出一份示例 JSON，给用户可编辑的起点 */
  channelsExportSample: 'channels:exportSample',

  credVerify: 'cred:verify',

  taskRun: 'task:run',
  taskProgress: 'task:progress',
  /** 只读：看看这个输入包能不能按当前设置出包（证书是谁签的、有没有 v2） */
  taskCheckSource: 'task:checkSource',

  walleShow: 'walle:show',

  packExport: 'pack:export',
  /** 选包 + 校验 + 探测冲突，只读不改 */
  packImport: 'pack:import',
  /** 用户确认冲突策略后真正落盘 */
  packImportApply: 'pack:importApply',

  /** 写系统剪贴板；主进程会把路径里的家目录换成 %USERPROFILE% 再写 */
  clipboardWrite: 'clipboard:write',

  /** 用系统文件资源管理器打开一个目录或文件；返回错误信息，成功时为空串 */
  shellOpenPath: 'shell:openPath',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
