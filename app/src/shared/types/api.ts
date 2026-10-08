import type { RuntimeCheckResult } from './runtime'
import type {
  ChannelConfig,
  ChannelEntry,
  CredentialVerifyResult,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreSnapshot,
  TemplateFile,
} from './store'
import type { TaskInput, TaskProgressEvent, TaskStartResult, WalleShowResult } from './task'
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

  /** 取存储快照：jks 列表、模板、数据目录。界面启动时调一次 */
  loadStore(): Promise<StoreSnapshot>

  /** 新增 / 更新 / 删除 jks。新增时复制副本，删除时一并清副本与渠道文件 */
  saveJks(mutation: JksMutation): Promise<JksMutationResult>

  /** 读 sourcePath 现内容与记录指纹比对，只报告差异，不自动同步 */
  refreshJksFromSource(id: string): Promise<RefreshResult>

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

  /** 用 walle show 查看某个 APK 的渠道信息 */
  showChannel(apkPath: string): Promise<WalleShowResult>

  /**
   * 导出渠道 JSON。导出的是**界面上**的列表（含尚未保存的修改），
   * 不是磁盘上那份 —— 导入只填界面，两者必须以界面为准才自洽。
   * 取消时 canceled 为 true。
   */
  exportChannels(
    id: string,
    app: string,
    channelInfoList: ChannelEntry[],
  ): Promise<ChannelExportResult>

  /**
   * 选渠道 JSON 并解析，**只读不落盘**，返回文件里的条目供用户预览与编辑。
   * 用户取消时返回 null。
   */
  previewChannels(app: string): Promise<ChannelListPreview | null>

  /**
   * 导出示例渠道 JSON。只在渠道列表为空时提供 ——
   * 条目来自「渠道模板」页的模板，模板为空时退回内置的两条兜底示例。
   */
  exportSampleChannels(
    id: string,
    app: string,
    prefix: string,
  ): Promise<ChannelSampleExportResult>

  /** 导出配置包 zip。导出前界面必须提示包内含明文密码与私钥 */
  exportConfigPack(): Promise<PackExportResult>

  /** 选配置包并校验、探测冲突。只读，不改任何数据 */
  pickConfigPack(): Promise<PackPreviewResult>

  /** 按用户选定的冲突策略真正导入 */
  applyConfigPack(input: {
    packPath: string
    conflictStrategy: ConflictStrategy
    overwriteTemplate: boolean
  }): Promise<PackImportResult>
}
