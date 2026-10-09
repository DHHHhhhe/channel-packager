import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type { ChannelEntry } from '../../shared/types/store'
import type {
  ChannelExportResult,
  ChannelListPreview,
  ChannelSampleExportResult,
  PackExportResult,
  PackImportResult,
  PackPreviewResult,
} from '../../shared/types/pack'
import {
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
  ipcMain.handle(
    IPC_CHANNELS.packExport,
    async (_event, includeCredentials: boolean): Promise<PackExportResult> => {
      const targetPath = await pickSavePath(
        includeCredentials ? '导出配置包' : '导出不含凭据的配置包',
        includeCredentials ? `渠道配置包_${today()}.zip` : `渠道模板_${today()}.zip`,
        [{ name: '配置包', extensions: ['zip'] }],
      )
      if (targetPath === null) {
        return { canceled: true }
      }
      return exportConfigPack({ targetPath, includeCredentials })
    },
  )

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
    async (
      _event,
      id: string,
      app: string,
      channelInfoList: ChannelEntry[],
    ): Promise<ChannelExportResult> => {
      const targetPath = await pickSavePath(
        '导出渠道 JSON',
        `${id}_channels.json`,
        [{ name: 'JSON', extensions: ['json'] }],
      )
      if (targetPath === null) {
        return { canceled: true }
      }
      return {
        canceled: false,
        path: targetPath,
        count: exportChannels(app, targetPath, channelInfoList),
      }
    },
  )

  /*
   * 导入只到「解析」为止：把文件里的条目读出来交给渲染层，
   * 由用户在预览框里改、选覆盖还是追加，确认后填进界面列表。
   * 落盘统一走「保存渠道列表」—— 所以这里没有对应的 apply 通道。
   */
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
}
