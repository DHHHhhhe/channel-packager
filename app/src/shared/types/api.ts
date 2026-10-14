import type { RuntimeCheckResult } from './runtime'
import type { ThemeChoice } from './settings'
import type { UpdateState } from './update'
import type {
  ChannelConfig,
  ChannelEntry,
  CredentialVerifyResult,
  GroupMutation,
  GroupMutationResult,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreProblem,
  StoreSnapshot,
  TemplateFile,
} from './store'
import type {
  SignMode,
  SourceCheckResult,
  TaskInput,
  TaskProgressEvent,
  TaskRunningState,
  TaskStartResult,
  WalleShowResult,
} from './task'
import type {
  ChannelExportResult,
  ChannelListPreview,
  ChannelSampleExportResult,
  ConflictStrategy,
  PackExportResult,
  PackImportResult,
  PackPreviewResult,
} from './pack'

/**
 * 应用菜单发过来的导航命令：四个页面 id，外加 save（保存当前页）。
 * 键位由渲染层的全局按键处理，菜单只负责「让人看见有哪些键」以及给鼠标用户入口。
 */
export type NavCommand = 'pack' | 'jks' | 'channels' | 'template' | 'save'

/**
 * preload 通过 contextBridge 暴露到 window.api 的白名单接口。
 * 主进程与渲染进程共用此类型，保证两边签名一致。
 */
export interface RendererApi {
  /**
   * 取拖拽文件的真实绝对路径。
   * 只对用户真实拖入的文件有效，渲染层伪造的 File 取不到路径。
   */
  pathForFile(file: File): string

  /** 检查内置运行时（java / keytool / zipalign / apksigner / walle）是否齐备 */
  checkRuntime(): Promise<RuntimeCheckResult>

  /**
   * 启动时生效的主题选择。
   *
   * 走的是主进程建窗口时注入的启动参数，**同步**可读 —— 渲染层必须在第一帧
   * 之前就把 `.dark` 挂上，否则会先亮一下再变暗。主进程那边还有一份落盘的真值。
   */
  readonly initialTheme: ThemeChoice

  /**
   * 当前应用版本，显示在侧边栏底部。
   * 自动更新之后用户得能自己看出「确实换成新版本了」，否则只能靠猜。
   */
  readonly appVersion: string

  /** 切换主题。主进程落盘并改 nativeTheme，返回实际生效的选择 */
  setTheme(choice: ThemeChoice): Promise<ThemeChoice>

  /** 读「启动时自动检查更新」开关。默认开 */
  getAutoCheckUpdate(): Promise<boolean>

  /**
   * 写「启动时自动检查更新」开关，返回写入后的值。
   * 打开时主进程会顺手查一次更新，界面不需要自己再触发一遍。
   */
  setAutoCheckUpdate(enabled: boolean): Promise<boolean>

  /** 取存储快照：jks 列表、模板、数据目录。界面启动时调一次 */
  loadStore(): Promise<StoreSnapshot>

  /**
   * 取走并清空「读到坏文件」的记录。
   * 渠道列表是按需逐个读的，读完之后补调一次，问题才会冒到界面上。
   */
  takeStoreProblems(): Promise<StoreProblem[]>

  /** 新增 / 更新 / 删除 jks。新增时复制副本；删除时只清副本，不再级联删渠道（R4） */
  saveJks(mutation: JksMutation): Promise<JksMutationResult>

  /** 读 sourcePath 现内容与记录指纹比对，只报告差异，不自动同步 */
  refreshJksFromSource(id: string): Promise<RefreshResult>

  /**
   * 用原文件覆盖副本，保留显示名、别名与密码。
   * 会换掉签名身份，界面必须先让用户确认再调。
   */
  syncJksFromSource(id: string): Promise<RefreshResult>

  /** 新增 / 更新 / 删除分组。删除时一并清掉它的渠道文件 */
  saveGroup(mutation: GroupMutation): Promise<GroupMutationResult>

  /** 键是**分组 id**，不是 jks id */
  getChannels(id: string): Promise<ChannelConfig>
  saveChannels(id: string, config: ChannelConfig): Promise<ChannelConfig>
  saveTemplate(template: TemplateFile): Promise<TemplateFile>

  /**
   * 用内置 keytool 校验凭据，并取回真实别名。
   * 只用副本文件，不读 sourcePath。
   */
  verifyCredentials(
    id: string,
    password: string,
    expectedAlias?: string,
  ): Promise<CredentialVerifyResult>

  /**
   * 启动出包任务。按契约**立刻**返回 taskId，不等待跑完 ——
   * 阶段与实时输出都走 onTaskProgress，终态事件里带完整结果。
   */
  runTask(input: TaskInput): Promise<TaskStartResult>

  /**
   * 订阅出包进度，返回取消订阅函数。
   * 组件卸载时务必调用，否则重复挂载会累积监听器、同一行输出收到多次。
   */
  onTaskProgress(listener: (event: TaskProgressEvent) => void): () => void

  /**
   * 订阅应用菜单里的页面/保存命令，返回取消订阅函数。
   * 菜单项上的快捷键只是展示，按键本身由渲染层的全局按键处理 —— 见 store/nav.tsx。
   */
  onNavCommand(listener: (command: NavCommand) => void): () => void

  /**
   * 取消正在跑的出包任务。返回是否真的取消了 —— 任务已经跑完时返回 false，
   * 界面据此不要说「已取消」。
   */
  cancelTask(): Promise<boolean>

  /**
   * 现在有没有任务在跑。切页回来或刷新窗口后用它把状态接上，
   * 否则界面会以为没跑过，再点一次还会被「已有任务在进行」拒掉。
   */
  getRunningTask(): Promise<TaskRunningState | null>

  /** 选一个目录（输出目录这类手打路径的场景）。用户取消时返回 null */
  pickDirectory(title: string, defaultPath: string): Promise<string | null>

  /** 用 walle show 查看某个 APK 的渠道信息 */
  showChannel(apkPath: string): Promise<WalleShowResult>

  /**
   * 只读地看一眼「这个包按当前设置能不能出」—— 出包表单用来提前告知，
   * 真正的权威校验仍在流水线里（那里失败会中止出包）。
   * jksId 传空串表示不重签名、只写渠道。
   */
  checkSource(apkPath: string, jksId: string, signMode: SignMode): Promise<SourceCheckResult>

  /**
   * 导出渠道 JSON。导出的是**界面上**的列表（含尚未保存的修改），
   * 不是磁盘上那份 —— 导入只填界面，两者必须以界面为准才自洽。
   * 取消时 canceled 为 true。
   */
  exportChannels(id: string, channelInfoList: ChannelEntry[]): Promise<ChannelExportResult>

  /**
   * 选渠道 JSON 并解析，**只读不落盘**，返回文件里的条目供用户预览与编辑。
   * 用户取消时返回 null。
   */
  previewChannels(): Promise<ChannelListPreview | null>

  /**
   * 导出示例渠道 JSON。只在渠道列表为空时提供 ——
   * 条目来自「渠道模板」页的模板，模板为空时退回内置的两条兜底示例。
   */
  exportSampleChannels(id: string, prefix: string): Promise<ChannelSampleExportResult>

  /**
   * 导出配置包 zip。
   * `includeCredentials` 为 false 时只带 template.json 与一份空的 jks.json，
   * 给同事当初始包用；为 true 时包内含明文密码与私钥，导出前界面必须提示。
   */
  exportConfigPack(includeCredentials: boolean): Promise<PackExportResult>

  /** 选配置包并校验、探测冲突。只读，不改任何数据 */
  pickConfigPack(): Promise<PackPreviewResult>

  /** 按用户选定的冲突策略真正导入 */
  applyConfigPack(input: {
    packPath: string
    conflictStrategy: ConflictStrategy
    overwriteTemplate: boolean
  }): Promise<PackImportResult>

  /**
   * 写系统剪贴板。主进程会先把路径里的家目录换成 `%USERPROFILE%` 再写 ——
   * 复制的多是失败诊断，里面全是本机绝对路径，发给别人前不必再手工改。
   */
  writeClipboard(text: string): Promise<void>

  /**
   * 用系统文件资源管理器打开一个目录或文件。
   *
   * 返回错误信息，成功时是空串（`shell.openPath` 的契约）。路径不存在时也会
   * 直接返回一句中文说明，不会弹出系统自己的报错框。
   */
  openPath(targetPath: string): Promise<string>

  /**
   * 手动检查一次更新。菜单里的「检查更新」走这里。
   * 启动后主进程也会自己查一遍（只有安装版才有这条路，见 main/updater.ts）。
   */
  checkUpdate(): Promise<UpdateState>

  /**
   * 开始下载已发现的新版本。
   *
   * 检查到新版本不会自动下载（主进程把 autoDownload 关了），要等用户点「下载并更新」；
   * 没有待下载的版本时主进程直接返回当前状态，什么也不做。
   */
  downloadUpdate(): Promise<UpdateState>

  /** 当前更新状态。窗口重新加载后用它把提示条接上 */
  getUpdateState(): Promise<UpdateState>

  /**
   * 下载完成后立即重启并安装。
   * 有出包任务在跑时不要调 —— 重启会把它掐掉，界面要先拦一道。
   */
  installUpdate(): Promise<void>

  /** 订阅更新状态变化，返回取消订阅函数 */
  onUpdateState(listener: (state: UpdateState) => void): () => void
}
