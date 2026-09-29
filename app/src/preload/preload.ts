import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/channels'
import type { RendererApi } from '../shared/types/api'
import type { RuntimeCheckResult } from '../shared/types/runtime'

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
}

contextBridge.exposeInMainWorld('api', api)
