import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/channels'
import type { NavCommand, RendererApi } from '../shared/types/api'
import type { RuntimeCheckResult } from '../shared/types/runtime'
import { parseThemeChoice, type ThemeChoice } from '../shared/types/settings'
import type { UpdateState } from '../shared/types/update'
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
} from '../shared/types/store'
import type {
  SignMode,
  SourceCheckResult,
  TaskInput,
  TaskProgressEvent,
  TaskRunningState,
  TaskStartResult,
  WalleShowResult,
} from '../shared/types/task'
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
 * 主进程建窗口时通过 webPreferences.additionalArguments 注入的启动参数前缀。
 * 走启动参数而不是 IPC，是为了让渲染层**同步**拿到 —— 首帧之前就得挂上 `.dark`。
 */
const THEME_ARG_PREFIX = '--dsh-theme='

/** 主进程注入的版本号参数前缀，同上：同步可读，首帧就能显示在侧边栏 */
const VERSION_ARG_PREFIX = '--dsh-version='

/** 取不到或认不出都当「跟随系统」，主进程那边还有一份落盘的真值兜底 */
function readInitialTheme(): ThemeChoice {
  const arg = process.argv.find((value) => value.startsWith(THEME_ARG_PREFIX))
  return parseThemeChoice(arg?.slice(THEME_ARG_PREFIX.length))
}

/** 版本号取不到就留空，界面上少一行而已，不值得因此报错 */
function readAppVersion(): string {
  const arg = process.argv.find((value) => value.startsWith(VERSION_ARG_PREFIX))
  return arg ? arg.slice(VERSION_ARG_PREFIX.length) : ''
}

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

  initialTheme: readInitialTheme(),

  appVersion: readAppVersion(),

  setTheme(choice: ThemeChoice): Promise<ThemeChoice> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSaveTheme, choice)
  },

  getAutoCheckUpdate(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeGetAutoCheckUpdate)
  },

  setAutoCheckUpdate(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSetAutoCheckUpdate, enabled)
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

  syncJksFromSource(id: string): Promise<RefreshResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.jksSyncFromSource, id)
  },

  saveGroup(mutation: GroupMutation): Promise<GroupMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.storeSaveGroup, mutation)
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

  onNavCommand(listener: (command: NavCommand) => void): () => void {
    // 同样只把负载交出去，IpcRendererEvent 不上送
    const handler = (_event: IpcRendererEvent, command: NavCommand): void => {
      listener(command)
    }
    ipcRenderer.on(IPC_CHANNELS.navCommand, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.navCommand, handler)
    }
  },

  showChannel(apkPath: string): Promise<WalleShowResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.walleShow, apkPath)
  },

  cancelTask(): Promise<boolean> {
    return ipcRenderer.invoke(IPC_CHANNELS.taskCancel)
  },

  getRunningTask(): Promise<TaskRunningState | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.taskGetRunning)
  },

  pickDirectory(title: string, defaultPath: string): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.dialogPickDirectory, title, defaultPath)
  },

  checkSource(apkPath: string, jksId: string, signMode: SignMode): Promise<SourceCheckResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.taskCheckSource, apkPath, jksId, signMode)
  },

  exportChannels(id: string, channelInfoList: ChannelEntry[]): Promise<ChannelExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsExport, id, channelInfoList)
  },

  previewChannels(): Promise<ChannelListPreview | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsImport)
  },

  exportSampleChannels(id: string, prefix: string): Promise<ChannelSampleExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.channelsExportSample, id, prefix)
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

  checkUpdate(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateCheck)
  },

  downloadUpdate(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateDownload)
  },

  getUpdateState(): Promise<UpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateGetState)
  },

  installUpdate(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateInstall)
  },

  onUpdateState(listener: (state: UpdateState) => void): () => void {
    // 同样只把负载交出去，IpcRendererEvent 不上送
    const handler = (_event: IpcRendererEvent, payload: UpdateState): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.updateState, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.updateState, handler)
    }
  },

  consumeVersionNotice(): Promise<{ from: string; to: string } | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.updateConsumeVersionNotice)
  },

  getRepoUrl(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.appRepoUrl)
  },
}

contextBridge.exposeInMainWorld('api', api)
