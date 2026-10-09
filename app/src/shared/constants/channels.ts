/**
 * IPC 通道名的唯一来源。主进程注册与 preload 调用都从这里取，
 * 避免两边各写一遍字符串导致拼错。
 */
export const IPC_CHANNELS = {
  runtimeCheck: 'runtime:check',

  storeLoad: 'store:load',
  storeSaveJks: 'store:saveJks',
  jksRefreshFromSource: 'jks:refreshFromSource',
  /** 用原文件覆盖副本，保留显示名/别名/密码。会换掉签名身份，调用方先确认 */
  jksSyncFromSource: 'jks:syncFromSource',

  storeGetChannels: 'store:getChannels',
  storeSaveChannels: 'store:saveChannels',
  /** 分组索引的增改删。渠道条目本身仍走 store:saveChannels */
  storeSaveGroup: 'store:saveGroup',
  storeSaveTemplate: 'store:saveTemplate',
  /** 取走并清空「读到坏文件」的记录；读不到的文件不存在时不算坏 */
  storeTakeProblems: 'store:takeProblems',

  /** 切换主题（跟随系统 / 浅色 / 深色）。主进程负责落盘并改 nativeTheme */
  storeSaveTheme: 'store:saveTheme',

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
  /** 取消正在跑的出包任务：强杀当前子进程，流水线以「已取消」收尾 */
  taskCancel: 'task:cancel',
  /** 只读：现在有没有任务在跑。切页回来 / 刷新窗口后用它把状态接上 */
  taskGetRunning: 'task:getRunning',

  /** 选一个目录（输出目录这类手打路径的场景） */
  dialogPickDirectory: 'dialog:pickDirectory',

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

  /** 菜单里的页面/保存命令，由主进程推给渲染层。快捷键的键位写在菜单上才有人看得见 */
  navCommand: 'nav:command',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
