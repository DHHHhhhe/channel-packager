import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type { ThemeChoice } from '../../shared/types/settings'
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
import { saveTheme } from '../theme'
import {
  applyGroupMutation,
  drainStoreProblems,
  migrateGroupsIfNeeded,
  readChannels,
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
    // 键是**分组 id**；文件缺失时给一份空配置，界面自己决定怎么提示
    return readChannels(id)
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

  /**
   * 切主题。主进程是唯一真源：写 settings.json 并改 nativeTheme，
   * 渲染层的 prefers-color-scheme 会跟着变，`.dark` 类由渲染层自己同步。
   */
  ipcMain.handle(IPC_CHANNELS.storeSaveTheme, (_event, choice: ThemeChoice): ThemeChoice =>
    saveTheme(choice),
  )
}
