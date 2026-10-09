import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type {
  ChannelConfig,
  GroupMutation,
  GroupMutationResult,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreProblem,
  StoreSnapshot,
  TemplateFile,
} from '../../shared/types/store'
import { addKeystore, refreshFromSource, removeJksItem, updateJksItem } from '../keystore'
import { getDataDir, isUsingFallbackDataDir } from '../paths'
import {
  applyGroupMutation,
  drainStoreProblems,
  migrateGroupsIfNeeded,
  readChannels,
  readGroups,
  readJksFile,
  readTemplate,
  writeChannels,
  writeTemplate,
} from '../store'

export function registerStoreIpc(): void {
  ipcMain.handle(IPC_CHANNELS.storeLoad, (): StoreSnapshot => {
    // 顺序不能反：先把文件读一遍，问题才会攒下来，然后一次取走。
    // 迁移也得排在读分组前面 —— 老数据先变成分组，界面才看得到
    const groups = migrateGroupsIfNeeded()
    const jks = readJksFile()
    const template = readTemplate()
    return {
      jks,
      groups,
      template,
      dataDir: getDataDir(),
      usedFallback: isUsingFallbackDataDir(),
      problems: drainStoreProblems(),
    }
  })

  /**
   * 渠道列表是逐个按需读的，坏文件得另外取一次。
   * 渲染层在 getChannels 之后调它，把问题并到顶部横幅上。
   */
  ipcMain.handle(IPC_CHANNELS.storeTakeProblems, (): StoreProblem[] => drainStoreProblems())

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
          throw new Error(`未知的签名文件操作：${JSON.stringify(mutation)}`)
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.jksRefreshFromSource, (_event, id: string): RefreshResult => {
    return refreshFromSource(id)
  })

  ipcMain.handle(IPC_CHANNELS.storeGetChannels, (_event, id: string): ChannelConfig => {
    // 键是**分组 id**。老数据（还没迁移过、或渠道文件是孤儿）退回 jks 条目上的 app
    const group = readGroups().items.find((entry) => entry.id === id)
    const legacy = readJksFile().items.find((entry) => entry.id === id)
    return readChannels(id, group?.app ?? legacy?.app ?? id)
  })

  ipcMain.handle(
    IPC_CHANNELS.storeSaveGroup,
    (_event, mutation: GroupMutation): GroupMutationResult => applyGroupMutation(mutation),
  )

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
