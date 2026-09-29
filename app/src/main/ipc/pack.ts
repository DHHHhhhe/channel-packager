import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type {
  ChannelExportResult,
  ChannelImportResult,
  PackExportResult,
  PackImportResult,
  PackPreviewResult,
} from '../../shared/types/pack'
import {
  exportChannels,
  exportConfigPack,
  importChannels,
  importConfigPack,
  previewConfigPack,
  type PackImportInput,
} from '../configpack'

function ownerWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function today(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 文件选择交给主进程做。
 * 渲染层因此永远不需要拿到、也不该拿到任意路径 —— 通道只收一个「要做什么」。
 */
async function pickSavePath(
  title: string,
  defaultName: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const window = ownerWindow()
  const result = window
    ? await dialog.showSaveDialog(window, { title, defaultPath: defaultName, filters })
    : await dialog.showSaveDialog({ title, defaultPath: defaultName, filters })
  return result.canceled || !result.filePath ? null : result.filePath
}

async function pickOpenPath(
  title: string,
  filters: Electron.FileFilter[],
): Promise<string | null> {
  const window = ownerWindow()
  const options: Electron.OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters,
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export function registerPackIpc(): void {
  ipcMain.handle(IPC_CHANNELS.packExport, async (): Promise<PackExportResult> => {
    const targetPath = await pickSavePath(
      '导出配置包',
      `渠道配置包_${today()}.zip`,
      [{ name: '配置包', extensions: ['zip'] }],
    )
    if (targetPath === null) {
      return { canceled: true }
    }
    return exportConfigPack({ targetPath })
  })

  ipcMain.handle(IPC_CHANNELS.packImport, async (): Promise<PackPreviewResult> => {
    const packPath = await pickOpenPath('选择配置包', [{ name: '配置包', extensions: ['zip'] }])
    if (packPath === null) {
      return { canceled: true }
    }
    return previewConfigPack(packPath)
  })

  ipcMain.handle(
    IPC_CHANNELS.packImportApply,
    (_event, input: PackImportInput): Promise<PackImportResult> => importConfigPack(input),
  )

  ipcMain.handle(
    IPC_CHANNELS.channelsExport,
    async (_event, id: string, app: string): Promise<ChannelExportResult> => {
      const targetPath = await pickSavePath(
        '导出渠道 JSON',
        `${id}_channels.json`,
        [{ name: 'JSON', extensions: ['json'] }],
      )
      if (targetPath === null) {
        return { canceled: true }
      }
      return { canceled: false, path: targetPath, count: exportChannels(id, app, targetPath) }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.channelsImport,
    async (_event, id: string, app: string): Promise<ChannelImportResult | null> => {
      const sourcePath = await pickOpenPath('导入渠道 JSON', [{ name: 'JSON', extensions: ['json'] }])
      if (sourcePath === null) {
        return null
      }
      const result = importChannels(id, app, sourcePath)
      // 渠道列表要写进 walle 的 defaultExtraInfo.app，app 取自 jks 条目而非文件
      return result
    },
  )
}
