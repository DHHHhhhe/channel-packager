import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/channels'
import type { CredentialVerifyResult } from '../../shared/types/store'
import { verifyCredentials } from '../credential'

export function registerCredentialIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.credVerify,
    (_event, id: string, password: string, expectedAlias?: string): Promise<CredentialVerifyResult> => {
      return verifyCredentials(id, password, expectedAlias)
    },
  )
}
