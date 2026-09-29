import type { RuntimeCheckResult } from './runtime'
import type {
  ChannelConfig,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreSnapshot,
  TemplateFile,
} from './store'

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
}
