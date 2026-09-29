import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import { checkRuntime } from '../runtime'
import type { RuntimeCheckResult } from '../../shared/types/runtime'

export function registerRuntimeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.runtimeCheck, (): RuntimeCheckResult => checkRuntime())
}
