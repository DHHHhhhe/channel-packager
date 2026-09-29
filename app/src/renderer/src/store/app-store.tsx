import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  ChannelConfig,
  CredentialVerifyResult,
  JksItem,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  TemplateFile,
} from '@shared/types/store'
import { ipcErrorMessage } from '@/lib/ipc-error'

interface AppStoreValue {
  loading: boolean
  /** 读取存储失败时的原因，成功为 null */
  loadError: string | null
  dataDir: string
  usedFallback: boolean
  jksItems: JksItem[]
  template: TemplateFile
  reload: () => Promise<void>
  saveJks: (mutation: JksMutation) => Promise<JksMutationResult>
  saveTemplate: (template: TemplateFile) => Promise<void>
  getChannels: (id: string) => Promise<ChannelConfig>
  saveChannels: (id: string, config: ChannelConfig) => Promise<void>
  refreshJks: (id: string) => Promise<RefreshResult>
  verifyCredentials: (
    id: string,
    password: string,
    alias?: string,
  ) => Promise<CredentialVerifyResult>
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

/**
 * 全应用共用一份存储快照。
 * jks 列表与模板会被多个界面读到，放在 Context 里避免层层传参与各页面重复加载。
 */
export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [usedFallback, setUsedFallback] = useState(false)
  const [jksItems, setJksItems] = useState<JksItem[]>([])
  const [template, setTemplate] = useState<TemplateFile>({ version: 1, suffixes: [] })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await window.api.loadStore()
      setDataDir(snapshot.dataDir)
      setUsedFallback(snapshot.usedFallback)
      setJksItems(snapshot.jks.items)
      setTemplate(snapshot.template)
      setLoadError(null)
    } catch (error) {
      setLoadError(ipcErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<AppStoreValue>(
    () => ({
      loading,
      loadError,
      dataDir,
      usedFallback,
      jksItems,
      template,
      reload,
      async saveJks(mutation: JksMutation) {
        const result = await window.api.saveJks(mutation)
        setJksItems(result.items)
        return result
      },
      async saveTemplate(next: TemplateFile) {
        const saved = await window.api.saveTemplate(next)
        setTemplate(saved)
      },
      getChannels(id: string) {
        return window.api.getChannels(id)
      },
      async saveChannels(id: string, config: ChannelConfig) {
        await window.api.saveChannels(id, config)
      },
      refreshJks(id: string) {
        return window.api.refreshJksFromSource(id)
      },
      verifyCredentials(id: string, password: string, alias?: string) {
        return window.api.verifyCredentials(id, password, alias)
      },
    }),
    [loading, loadError, dataDir, usedFallback, jksItems, template, reload],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext)
  if (!value) {
    throw new Error('useAppStore 必须在 AppStoreProvider 内使用')
  }
  return value
}
