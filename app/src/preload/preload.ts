import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/channels'
import type { RendererApi } from '../shared/types/api'
import type { RuntimeCheckResult } from '../shared/types/runtime'
import type {
  ChannelConfig,
  ChannelEntry,
  CredentialVerifyResult,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreProblem,
  StoreSnapshot,
  TemplateFile,
} from '../shared/types/store'
import type { TaskInput, TaskProgressEvent, TaskStartResult, WalleShowResult } from '../shared/types/task'
import type {
  ChannelExportResult,
  ChannelListPreview,
  ChannelSampleExportResult,
  ConflictStrategy,
  PackExportResult,
  PackImportResult,
  PackPreviewResult,
} from '../shared/types/pack'

/**
 * 渲染进程触达宿主的唯一入口。
 * contextIsolation 打开后渲染层拿不到 Node 与 Electron 的任何对象，
 * 只能用到这里显式暴露的方法 —— 通道名集中在 shared/constants/channels.ts。
 */
const api: RendererApi = {
  /**
   * 取拖拽文件的真实绝对路径。
   * Electron 32 起 File.path 已被移除，官方替代正是 webUtils.getPathForFile，
   * 且它只能在 preload 里调用。walle 与 apksigner 都需要真实路径，绕不开。
   */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  checkRuntime(): Promise<RuntimeCheckResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.runtimeCheck)
  },

  loadStore(): Promise<StoreSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeLoad)
  },

  takeStoreProblems(): Promise<StoreProblem[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeTakeProblems)
  },

  saveJks(mutation: JksMutation): Promise<JksMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSaveJks, mutation)
  },

  refreshJksFromSource(id: string): Promise<RefreshResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.jksRefreshFromSource, id)
  },

  getChannels(id: string): Promise<ChannelConfig> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeGetChannels, id)
  },

  saveChannels(id: string, config: ChannelConfig): Promise<ChannelConfig> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSaveChannels, id, config)
  },

  saveTemplate(template: TemplateFile): Promise<TemplateFile> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSaveTemplate, template)
  },

  verifyCredentials(
    id: string,
    password: string,
    expectedAlias?: string,
  ): Promise<CredentialVerifyResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.credVerify, id, password, expectedAlias)
  },

  runTask(input: TaskInput): Promise<TaskStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.taskRun, input)
  },

  onTaskProgress(listener: (event: TaskProgressEvent) => void): () => void {
    /*
     * 只把事件负载交给回调。IpcRendererEvent 上挂着 sender，把它漏进渲染层
     * 等于递出去一条回主进程的通道，白名单就形同虚设。
     */
    const handler = (_event: IpcRendererEvent, payload: TaskProgressEvent): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.taskProgress, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.taskProgress, handler)
    }
  },

  showChannel(apkPath: string): Promise<WalleShowResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.walleShow, apkPath)
  },

  exportChannels(
    id: string,
    app: string,
    channelInfoList: ChannelEntry[],
  ): Promise<ChannelExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsExport, id, app, channelInfoList)
  },

  previewChannels(app: string): Promise<ChannelListPreview | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsImport, app)
  },

  exportSampleChannels(
    id: string,
    app: string,
    prefix: string,
  ): Promise<ChannelSampleExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsExportSample, id, app, prefix)
  },

  exportConfigPack(includeCredentials: boolean): Promise<PackExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.packExport, includeCredentials)
  },

  pickConfigPack(): Promise<PackPreviewResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.packImport)
  },

  applyConfigPack(input: {
    packPath: string
    conflictStrategy: ConflictStrategy
    overwriteTemplate: boolean
  }): Promise<PackImportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.packImportApply, input)
  },

  writeClipboard(text: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.clipboardWrite, text)
  },

  openPath(targetPath: string): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.shellOpenPath, targetPath)
  },
}

contextBridge.exposeInMainWorld('api', api)
