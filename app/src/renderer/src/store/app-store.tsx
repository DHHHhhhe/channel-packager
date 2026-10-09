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
  GroupItem,
  GroupMutation,
  GroupMutationResult,
  JksItem,
  JksMutation,
  JksMutationResult,
  RefreshResult,
  StoreProblem,
  TemplateFile,
} from '@shared/types/store'
import { ipcErrorMessage } from '@/lib/ipc-error'

interface AppStoreValue {
  loading: boolean
  /**
   * 首次加载是否已经结束过一次。
   * 用它区分「首屏还在读」与「后台刷新」：后者不该把当前页面整个换掉 ——
   * 页面被卸载会连同它自己的状态（比如「已导入 N 条」这类提示）一起丢掉。
   */
  initialized: boolean
  /** 读取存储失败时的原因，成功为 null */
  loadError: string | null
  dataDir: string
  usedFallback: boolean
  /** 文件在、却读不出来的那些配置。空数组表示都正常 */
  problems: StoreProblem[]
  jksItems: JksItem[]
  /** 渠道分组。渠道列表的归属，与 jks 无关 */
  groups: GroupItem[]
  /**
   * 渠道列表的保存次数。
   *
   * 四个页面现在一直挂着（切页不再卸载），渠道配置页不会再因为「重新挂载」而重读
   * 磁盘。出包页的「自定义渠道导出」也会往同一个分组里存渠道 —— 存完得有个信号
   * 让渠道配置页知道该重读了，否则切过去看到的还是旧的那一份。
   */
  channelsRevision: number
  template: TemplateFile
  reload: () => Promise<void>
  saveJks: (mutation: JksMutation) => Promise<JksMutationResult>
  saveGroup: (mutation: GroupMutation) => Promise<GroupMutationResult>
  saveTemplate: (template: TemplateFile) => Promise<void>
  /** 键是分组 id */
  getChannels: (id: string) => Promise<ChannelConfig>
  saveChannels: (id: string, config: ChannelConfig) => Promise<void>
  refreshJks: (id: string) => Promise<RefreshResult>
  /** 用原文件覆盖副本，保留显示名/别名/密码。调用方先让用户确认 */
  syncJks: (id: string) => Promise<RefreshResult>
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
  const [initialized, setInitialized] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dataDir, setDataDir] = useState('')
  const [usedFallback, setUsedFallback] = useState(false)
  const [problems, setProblems] = useState<StoreProblem[]>([])
  const [jksItems, setJksItems] = useState<JksItem[]>([])
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [channelsRevision, setChannelsRevision] = useState(0)
  const [template, setTemplate] = useState<TemplateFile>({ version: 1, suffixes: [] })

  /** 按路径去重地并进问题列表，免得渠道列表读到的问题把 jks 列表那条顶掉 */
  const mergeProblems = useCallback((incoming: StoreProblem[]) => {
    if (incoming.length === 0) {
      return
    }
    setProblems((current) => {
      const merged = [...current]
      for (const problem of incoming) {
        if (!merged.some((entry) => entry.path === problem.path)) {
          merged.push(problem)
        }
      }
      return merged
    })
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await window.api.loadStore()
      setDataDir(snapshot.dataDir)
      setUsedFallback(snapshot.usedFallback)
      setJksItems(snapshot.jks.items)
      setGroups(snapshot.groups.items)
      setTemplate(snapshot.template)
      setProblems(snapshot.problems)
      setLoadError(null)
    } catch (error) {
      setLoadError(ipcErrorMessage(error))
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /*
   * 这些方法都用 useCallback 固定住身份。
   *
   * 不这么做的话，下面那个 useMemo 一重算（比如 channelsRevision 变了），所有方法
   * 都会换一份新的引用 —— 而页面里的读取 effect 是拿这些方法当依赖的，
   * 于是一次保存会连带触发别的页面重新读盘：刚显示的「已保存」被清掉，
   * 正在编辑的列表被磁盘内容冲掉。身份稳定，这些 effect 才只在真正该跑的时候跑。
   */
  const saveJks = useCallback(async (mutation: JksMutation): Promise<JksMutationResult> => {
    const result = await window.api.saveJks(mutation)
    setJksItems(result.items)
    return result
  }, [])

  const saveGroup = useCallback(async (mutation: GroupMutation): Promise<GroupMutationResult> => {
    const result = await window.api.saveGroup(mutation)
    setGroups(result.items)
    return result
  }, [])

  const saveTemplate = useCallback(async (next: TemplateFile): Promise<void> => {
    const saved = await window.api.saveTemplate(next)
    setTemplate(saved)
  }, [])

  const getChannels = useCallback(
    async (id: string): Promise<ChannelConfig> => {
      const config = await window.api.getChannels(id)
      // 渠道列表是读的时候才知道坏没坏，补取一次问题
      mergeProblems(await window.api.takeStoreProblems())
      return config
    },
    [mergeProblems],
  )

  const saveChannels = useCallback(async (id: string, config: ChannelConfig): Promise<void> => {
    await window.api.saveChannels(id, config)
    setChannelsRevision((current) => current + 1)
  }, [])

  const refreshJks = useCallback(
    (id: string): Promise<RefreshResult> => window.api.refreshJksFromSource(id),
    [],
  )

  /*
   * 刷新副本会换掉 jks.json 里的指纹，界面得跟着更新，
   * 所以成功之后把列表重读一遍，别让表格还显示旧 SHA256。
   * reload 的身份是固定的（下面那条注释说的就是这件事），可以安全地当依赖。
   */
  const syncJks = useCallback(
    async (id: string): Promise<RefreshResult> => {
      const result = await window.api.syncJksFromSource(id)
      if (result.status === 'synced') {
        await reload()
      }
      return result
    },
    [reload],
  )

  const verifyCredentials = useCallback(
    (id: string, password: string, alias?: string): Promise<CredentialVerifyResult> =>
      window.api.verifyCredentials(id, password, alias),
    [],
  )

  const value = useMemo<AppStoreValue>(
    () => ({
      loading,
      initialized,
      loadError,
      dataDir,
      usedFallback,
      problems,
      jksItems,
      groups,
      channelsRevision,
      template,
      reload,
      saveJks,
      saveGroup,
      saveTemplate,
      getChannels,
      saveChannels,
      refreshJks,
      syncJks,
      verifyCredentials,
    }),
    [
      loading,
      initialized,
      loadError,
      dataDir,
      usedFallback,
      problems,
      jksItems,
      groups,
      channelsRevision,
      template,
      reload,
      saveJks,
      saveGroup,
      saveTemplate,
      getChannels,
      saveChannels,
      refreshJks,
      syncJks,
      verifyCredentials,
    ],
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
