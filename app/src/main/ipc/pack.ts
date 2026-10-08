import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type {
  ChannelExportResult,
  ChannelImportMode,
  ChannelImportResult,
  ChannelListPreview,
  ChannelSampleExportResult,
  PackExportResult,
  PackImportResult,
  PackPreviewResult,
} from '../../shared/types/pack'
import {
  applyChannels,
  exportChannels,
  exportConfigPack,
  exportSampleChannels,
  importConfigPack,
  previewChannels,
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

  // 导入分两步：先只读解析给渲染层弹确认框，用户点了「确认导入」再落盘。
  // 渠道列表是整表替换，先看一眼比事后补救便宜。
  ipcMain.handle(
    IPC_CHANNELS.channelsImport,
    async (_event, app: string): Promise<ChannelListPreview | null> => {
      const sourcePath = await pickOpenPath('导入渠道 JSON', [{ name: 'JSON', extensions: ['json'] }])
      if (sourcePath === null) {
        return null
      }
      return previewChannels(app, sourcePath)
    },
  )

  // 渠道列表为空时给一份可编辑的起点：导出示例 JSON，改完走「导入 JSON」读回来
  ipcMain.handle(
    IPC_CHANNELS.channelsExportSample,
    async (_event, id: string, app: string, prefix: string): Promise<ChannelSampleExportResult> => {
      const targetPath = await pickSavePath('导出示例渠道 JSON', `${id}_channels_sample.json`, [
        { name: 'JSON', extensions: ['json'] },
      ])
      if (targetPath === null) {
        return { canceled: true }
      }
      const { count, fromTemplate } = exportSampleChannels(app, prefix, targetPath)
      return { canceled: false, path: targetPath, count, fromTemplate }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.channelsImportApply,
    (
      _event,
      id: string,
      app: string,
      sourcePath: string,
      mode: ChannelImportMode,
    ): ChannelImportResult =>
      // 渠道列表要写进 walle 的 defaultExtraInfo.app，app 取自 jks 条目而非文件
      applyChannels(id, app, sourcePath, mode),
  )
}
