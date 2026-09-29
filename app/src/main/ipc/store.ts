import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type {
  ChannelConfig,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreSnapshot,
  TemplateFile,
} from '../../shared/types/store'
import { addKeystore, refreshFromSource, removeJksItem, updateJksItem } from '../keystore'
import { getDataDir, isUsingFallbackDataDir } from '../paths'
import { readChannels, readJksFile, readTemplate, writeChannels, writeTemplate } from '../store'

export function registerStoreIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.storeLoad,
    (): StoreSnapshot => ({
      jks: readJksFile(),
      template: readTemplate(),
      dataDir: getDataDir(),
      usedFallback: isUsingFallbackDataDir(),
    }),
  )

  ipcMain.handle(
    IPC_CHANNELS.storeSaveJks,
    (_event, mutation: JksMutation): JksMutationResult => {
      switch (mutation.action) {
        case 'add':
          return addKeystore(mutation.sourcePath, {
            displayName: mutation.displayName,
            alias: mutation.alias,
            storePassword: mutation.storePassword,
            app: mutation.app,
          })
        case 'update':
          return updateJksItem(mutation.item)
        case 'remove':
          return removeJksItem(mutation.id)
        default:
          // 联合类型已穷尽，这里只防渲染层传进未知 action 时静默成功
          throw new Error(`未知的 jks 操作：${JSON.stringify(mutation)}`)
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.jksRefreshFromSource, (_event, id: string): RefreshResult => {
    return refreshFromSource(id)
  })

  ipcMain.handle(IPC_CHANNELS.storeGetChannels, (_event, id: string): ChannelConfig => {
    const item = readJksFile().items.find((entry) => entry.id === id)
    return readChannels(id, item?.app ?? id)
  })

  ipcMain.handle(
    IPC_CHANNELS.storeSaveChannels,
    (_event, id: string, config: ChannelConfig): ChannelConfig => {
      writeChannels(id, config)
      return config
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.storeSaveTemplate,
    (_event, template: TemplateFile): TemplateFile => {
      writeTemplate(template)
      return readTemplate()
    },
  )
}
