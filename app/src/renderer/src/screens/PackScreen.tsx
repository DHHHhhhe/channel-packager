import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FolderOpen,
  History,
  ListPlus,
  Package,
  Search,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  CustomChannelExportDialog,
  type CustomChannelExportPayload,
} from '@/components/CustomChannelExportDialog'
import { PageHeader } from '@/components/PageHeader'
import { PackQueueCard, type QueueItem } from '@/components/PackQueueCard'
import GroupPicker from '@/components/GroupPicker'
import { ProgressPanel } from '@/components/ProgressPanel'
import { TaskResultCard } from '@/components/TaskResultCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChannelEntry } from '@shared/types/store'
import type { SignMode, SourceCheckResult, TaskInput, WalleShowResult } from '@shared/types/task'
import { fileStem, matchGroupByApk } from '@/lib/group-match'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { NO_JKS_KEY, readLastGroup, writeLastGroup } from '@/lib/last-group'
import type { FixAction } from '@/lib/task-report'
import { useAppStore } from '@/store/app-store'
import { useNav } from '@/store/nav'
import { useTask } from '@/store/task'

/** 默认输出到 APK 同级的「渠道包」目录（K11） */
function defaultOutputDir(apkPath: string): string {
  if (!apkPath) {
    return ''
  }
  const normalized = apkPath.replace(/\//g, '\\')
  const cut = normalized.lastIndexOf('\\')
  return cut < 0 ? '渠道包' : `${normalized.slice(0, cut)}\\渠道包`
}

/**
 * 只取文件名。
 * 「查看渠道」的结果里不放完整路径：包没写过渠道时 walle 只会回一行 `<路径> : `，
 * 早先把整行当成渠道号显示，界面上就冒出一串没人要的目录。
 */
function baseNameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/** 「最近结果」里的时间，只到分钟 —— 那一段只用来分「哪次是哪次」 */
function clockOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Radix Select 不接受空串当 value，所以用这个哨兵表示「不用 jks」。
 * 真值不放 '' 是因为 '' 同时被用作「还没选」，两个意思混在一起会打架。
 */
const NO_JKS = '__none__'

export function PackScreen() {
  const { groups, groupChannelCounts, jksItems, channelsRevision, getChannels, saveChannels, initialized } =
    useAppStore()
  const { go } = useNav()
  const [apkPath, setApkPath] = useState('')
  const [dragging, setDragging] = useState(false)
  const [jksId, setJksId] = useState('')
  /*
   * true = 不用 jks 签名，只把渠道写进包（签名保持原样）。
   *
   * 用独立状态而不是把 jksId 置空：下面「自动选中第一个 jks」那条 effect 会把
   * 空 jksId 立刻填回去，置空的写法根本站不住。
   */
  const [noJks, setNoJks] = useState(false)
  /*
   * 渠道一律来自分组（A′）。分组与 jks 没有绑定关系：jks 只管签名，
   * 出包时选哪个分组是这一次的事，选过的那个记在本地当下次默认。
   */
  const [groupId, setGroupId] = useState('')
  const [channels, setChannels] = useState<ChannelEntry[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /** 渠道勾选区的搜索词：分组里几十上百条时，靠肉眼在网格里找太费劲 */
  const [channelQuery, setChannelQuery] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [signMode, setSignMode] = useState<SignMode>('sign')
  /** 出包表单上的提前判断：这个包能不能按当前设置出 */
  const [sourceCheck, setSourceCheck] = useState<SourceCheckResult | null>(null)
  /** ok = 全成；warning = 部分失败（可继续，但要留意）；error = 整批没成 */
  const [status, setStatus] = useState<{ kind: 'ok' | 'warning' | 'error'; text: string } | null>(
    null,
  )
  /** 「查看渠道」的结果，非 null 时弹窗展示 */
  const [showResult, setShowResult] = useState<WalleShowResult | null>(null)
  const [showTarget, setShowTarget] = useState('')
  const [showing, setShowing] = useState(false)

  /*
   * 出包任务的运行状态放在 TaskProvider 里，不在这一页。
   *
   * 任务跑起来之后人常要切去别的页面改配置，页里一卸载，进度订阅就断、状态就丢，
   * 队列循环还会停在「等这一项结果」那一句上再也不动，而主进程其实还在跑。
   * 放外层之后：切页不断、顶栏一直看得见进度、随时能取消。
   */
  const {
    running,
    stage,
    flow,
    lines,
    result,
    history,
    lastRun,
    queueProgress,
    start,
    runAndWait,
    reset: resetTask,
    setQueueProgress,
  } = useTask()
  /** 批量出包的队列。空数组时整个队列卡片不渲染 */
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [queueRunning, setQueueRunning] = useState(false)
  /** 上一次出包是不是「开始队列」发起的 —— 决定结果卡片归谁渲染 */
  const [ranQueue, setRanQueue] = useState(false)
  /** 「清空队列」的二次确认。整队一次丢光，点错一下就没法回头 */
  const [clearQueueOpen, setClearQueueOpen] = useState(false)
  /** 「最近结果」的展开状态。默认收起，只是偶尔回看 */
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 「自定义渠道导出」弹窗 */
  const [customOpen, setCustomOpen] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)
  /** 「重跑本次」时把上次那份自定义列表放回弹窗；null = 从空开始 */
  const [customInitial, setCustomInitial] = useState<{
    channels: ChannelEntry[]
  } | null>(null)
  // 「重跑本次」要恢复的勾选。渠道列表是异步读的，得等读完再套用，
  // 否则会被读盘那一步的「默认全选」盖掉。
  const pendingPickedRef = useRef<string[] | null>(null)
  /*
   * 每个分组各自记住勾选。
   *
   * 原来切分组一律重置成「全选」：只是想过去看一眼另一个分组的渠道，
   * 回来精心挑的那几条就没了。分组之间是并列的，不该互相清空。
   */
  const pickedByGroupRef = useRef<Map<string, string[]>>(new Map())
  const pickedRef = useRef(picked)
  pickedRef.current = picked
  const lastGroupIdRef = useRef('')
  /** 上一次点过的那条渠道在 visibleChannels 里的下标，给 Shift 连选用 */
  const lastPickedIndexRef = useRef<number | null>(null)
  /** 队列卡片：加入成功后滚过去，省得人以为没加上 */
  const queueCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 首屏还没读完就先不动：jksItems 初始是空数组，这时把 noJks 定成 true 会
    // 让有 jks 的人也进「不用 jks」模式。
    if (!initialized) {
      return
    }
    if (noJks) {
      return
    }
    if (jksItems.length === 0) {
      // 一个 jks 都没有：直接进「不用 jks」。只写渠道不需要私钥，
      // 不该因为签名配置是空的就完全没法出包。
      // signMode 一并落成 skip —— 否则下拉会显示成「重签名」，与真正会发生的事不符。
      setJksId('')
      setSignMode('skip')
      setNoJks(true)
      return
    }
    if (!jksItems.some((item) => item.id === jksId)) {
      setJksId(jksItems[0].id)
    }
  }, [initialized, jksItems, jksId, noJks])

  /*
   * 选中的分组不能用了（首次进入、或它刚在「渠道配置」里被删掉）就退到一个能用的：
   * 该签名身份上次用过的那个，没有就用第一个。
   *
   * 只在「当前这个不能用了」时才动它 —— 切「不用 jks」不该把已经挑好的分组换掉，
   * 签名与渠道来源是两件事。
   */
  useEffect(() => {
    if (!initialized) {
      return
    }
    if (groups.length === 0) {
      if (groupId !== '') {
        setGroupId('')
      }
      return
    }
    if (groups.some((item) => item.id === groupId)) {
      return
    }
    const remembered = readLastGroup(noJks ? NO_JKS_KEY : jksId)
    const target = groups.find((item) => item.id === remembered) ?? groups[0]
    setGroupId(target.id)
  }, [initialized, groups, groupId, noJks, jksId])

  /*
   * 切分组之前，先把当前这个分组的勾选记下来。
   *
   * 这个 effect 必须声明在读盘那个之前：它读的是「切换前」的勾选，
   * 而读盘是异步的，等它回来时 picked 已经被覆盖了。
   */
  useEffect(() => {
    const previous = lastGroupIdRef.current
    lastGroupIdRef.current = groupId
    if (previous !== '' && previous !== groupId) {
      pickedByGroupRef.current.set(previous, [...pickedRef.current])
    }
  }, [groupId])

  useEffect(() => {
    if (groupId === '') {
      setChannels([])
      setPicked(new Set())
      return
    }
    // 换了分组，上一份列表的搜索词留着只会让人以为新分组也是空的
    setChannelQuery('')
    lastPickedIndexRef.current = null
    let cancelled = false
    getChannels(groupId)
      .then((config) => {
        if (cancelled) {
          return
        }
        setChannels(config.channelInfoList)
        const codes = config.channelInfoList.map((entry) => entry.channel)
        const available = new Set(codes)
        const pending = pendingPickedRef.current
        if (pending !== null) {
          // 「重跑本次」恢复的勾选：只留这个分组里还存在的渠道，
          // 上一次跑完到现在的这段时间里渠道可能已经被删掉了。
          pendingPickedRef.current = null
          setPicked(new Set(pending.filter((code) => available.has(code))))
          return
        }
        const remembered = pickedByGroupRef.current.get(groupId)
        if (remembered !== undefined) {
          // 这个分组刚才挑过，按记忆恢复；期间被删掉的渠道去掉
          setPicked(new Set(remembered.filter((code) => available.has(code))))
          return
        }
        setPicked(new Set(codes))
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ kind: 'error', text: ipcErrorMessage(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [groupId, getChannels])

  const channelsRef = useRef(channels)
  channelsRef.current = channels
  /** 上一次补读对应的保存次数 */
  const readRevisionRef = useRef(channelsRevision)

  /*
   * 分组里的渠道可能在「渠道配置」页被改过（那边一保存，这边就该跟着变）。
   * 四个页面现在一直挂着，切回来不会再重新挂载读盘，所以自己盯着保存次数补读一次。
   *
   * 勾选按老规矩办：原来全选的，新增的也跟着选上（全选就是这个意思）；
   * 只挑了一部分的，保持原样，把已经不存在的渠道去掉。
   */
  useEffect(() => {
    if (readRevisionRef.current === channelsRevision) {
      return
    }
    readRevisionRef.current = channelsRevision
    if (!groupId) {
      return
    }
    const previousCount = channelsRef.current.length
    let cancelled = false
    getChannels(groupId)
      .then((config) => {
        if (cancelled) {
          return
        }
        const list = config.channelInfoList
        const available = new Set(list.map((entry) => entry.channel))
        setChannels(list)
        setPicked((previous) => {
          if (previous.size > 0 && previous.size === previousCount) {
            return available
          }
          return new Set([...previous].filter((code) => available.has(code)))
        })
      })
      .catch(() => {
        // 只是后台补读，失败就维持现状
      })
    return () => {
      cancelled = true
    }
  }, [channelsRevision, groupId, getChannels])

  /*
   * 提前把「这个包能不能按当前设置出」问出来。
   *
   * 加这条是因为证书核对原来只在流水线里跑，包是别人签的、手上没有对应私钥时，
   * 要等到点了「开始出包」跑完几步才被拦下 —— 那时候人已经以为快好了。
   * 600ms 是防抖：APK 路径是手打或拖进来的，逐字符敲完再问，别每敲一下就起个子进程。
   */
  useEffect(() => {
    const target = apkPath.trim()
    if (target === '' || !target.toLowerCase().endsWith('.apk')) {
      setSourceCheck(null)
      return
    }
    let cancelled = false
    // 参数一变就先清掉，免得上一份结论挂在那儿看着像新的
    setSourceCheck(null)
    const timer = window.setTimeout(() => {
      window.api
        .checkSource(target, noJks ? '' : jksId, signMode)
        .then((result) => {
          if (!cancelled) {
            setSourceCheck(result)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSourceCheck(null)
          }
        })
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [apkPath, noJks, jksId, signMode])

  /** 下拉要用的分组：把渠道数并进来，分组多了之后靠它分辨 */
  const groupOptions = useMemo(
    () => groups.map((group) => ({ ...group, channelCount: groupChannelCounts[group.id] ?? 0 })),
    [groups, groupChannelCounts],
  )

  const selectedJks = jksItems.find((item) => item.id === jksId)
  const selectedGroup = groups.find((item) => item.id === groupId)

  /*
   * 切「不用 jks」只换签名方式，渠道不动 —— 渠道来自哪个分组与用不用 jks 无关。
   * 清单里的勾选也就都还站得住，没必要清掉让人重挑一遍。
   */
  const switchToNoJks = () => {
    setNoJks(true)
    setJksId('')
    // 没有私钥就只能跳过签名，这里顺手改掉，省得人以为还能重签名
    setSignMode('skip')
  }

  const handlePickJks = (value: string) => {
    if (value === NO_JKS) {
      switchToNoJks()
      return
    }
    setNoJks(false)
    setJksId(value)
    // 换签名身份就回到这个 jks 上次配的那套渠道；没记过就用第一个
    const remembered = readLastGroup(value)
    const target = groups.find((item) => item.id === remembered) ?? groups[0]
    if (target) {
      setGroupId(target.id)
    }
  }

  /** 选分组，顺手记下来当作换回这个签名身份时的默认值 */
  const handlePickGroup = (value: string) => {
    setGroupId(value)
    writeLastGroup(noJks ? NO_JKS_KEY : jksId, value)
  }

  /*
   * 两个下拉是同一件事的两面：跳过签名不需要私钥，所以选它就等于选「不用 jks」；
   * 反过来选重签名就必须有 jks，于是切回 jks 那条路。两个方向都自动接上，
   * 免得人以为还得自己去另一个下拉里改一遍。
   *
   * 重签名时 jks 交给下面「自动选中第一个 jks」那条 effect 补 —— 这里放掉 noJks 就行。
   * 一个 jks 都没有时，重签名那一项在界面上是禁用的，走不到这里。
   */
  const handlePickSignMode = (value: SignMode) => {
    setSignMode(value)
    if (value === 'skip') {
      switchToNoJks()
      return
    }
    setNoJks(false)
  }

  const handleApk = (file: File | undefined) => {
    if (!file) {
      return
    }
    const pickedPath = window.api.pathForFile(file)
    if (!pickedPath) {
      setStatus({ kind: 'error', text: '没能取到文件路径，请重新选择。' })
      return
    }
    if (!pickedPath.toLowerCase().endsWith('.apk')) {
      setStatus({ kind: 'error', text: '请选择 .apk 文件。' })
      return
    }
    setApkPath(pickedPath)
    setOutputDir(defaultOutputDir(pickedPath))
    setStatus(null)

    /*
     * 拿这个包的几个身份去碰分组名，撞上就切过去 —— 出包时多半就是给这个应用的。
     *
     * 读清单是异步的（要解 ZIP 与二进制 XML），但不必等它：文件名这一路立刻就能比，
     * 读到应用名之后再补一次。一个都没撞上就什么都不做，分组保持原样，
     * 也就是这个签名身份上次用的那个。
     *
     * 走 handlePickGroup 而不是直接 setGroupId，是为了顺带把它记成「上次用的」。
     */
    const immediate = matchGroupByApk([fileStem(pickedPath)], groups)
    if (immediate) {
      handlePickGroup(immediate.id)
    }

    void window.api.readApkManifest(pickedPath).then((manifest) => {
      const matched = matchGroupByApk([manifest.label, manifest.packageName], groups)
      if (matched) {
        handlePickGroup(matched.id)
      }
    })
  }

  const toggleChannel = (channel: string, checked: boolean) => {
    setPicked((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(channel)
      } else {
        next.delete(channel)
      }
      return next
    })
  }

  /*
   * Shift + 点：把「上次点的那条」到「这次点的这条」之间整段设成同一种状态。
   *
   * 一次要勾中间十几条时，一条条点很容易漏；而且漏掉的那条要等出完包才发现。
   * 点中的那一条由 Checkbox 自己切好了（click 事件先到它、再冒泡到这里），
   * 所以这里只补区间里其它的那些，否则它会被切两次。
   */
  const handleChannelShiftClick = (event: MouseEvent<HTMLLabelElement>, index: number) => {
    const last = lastPickedIndexRef.current
    lastPickedIndexRef.current = index
    if (!event.shiftKey || last === null) {
      return
    }
    const from = Math.min(last, index)
    const to = Math.max(last, index)
    const anchor = visibleChannels[index]
    if (from === to || anchor === undefined) {
      return
    }
    const target = !picked.has(anchor.channel)
    const rest = visibleChannels
      .slice(from, to + 1)
      .filter((entry) => entry.channel !== anchor.channel)
      .map((entry) => entry.channel)
    setPicked((previous) => {
      const next = new Set(previous)
      for (const code of rest) {
        if (target) {
          next.add(code)
        } else {
          next.delete(code)
        }
      }
      return next
    })
  }

  /*
   * 焦点在渠道网格里时，Ctrl+A 勾上「看得见的那些」，再来一次取消。
   * 与全选按钮同一套口径：搜索过就只动筛出来的，看不见的不顺手改。
   */
  const handleChannelGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
      return
    }
    event.preventDefault()
    setPicked((previous) => {
      const next = new Set(previous)
      for (const entry of visibleChannels) {
        if (visibleAllPicked) {
          next.delete(entry.channel)
        } else {
          next.add(entry.channel)
        }
      }
      return next
    })
  }

  /*
   * 结果走弹窗而不是页面底部那一行状态文字：
   * 渠道号要完整显示，塞进一行很容易被截断。
   */
  const handleShowChannel = async () => {
    const target = apkPath.trim()
    if (!target) {
      setStatus({ kind: 'error', text: '请先选择 APK。' })
      return
    }
    setStatus(null)
    setShowTarget(target)
    setShowResult(null)
    setShowing(true)
    try {
      setShowResult(await window.api.showChannel(target))
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setShowing(false)
    }
  }

  /** 把当前表单的参数整理成一份出包输入；单次出包与「加入队列」共用 */
  const currentParams = (): TaskInput => {
    const base = {
      apkPath: apkPath.trim(),
      channelCodes: [...picked],
      signMode,
      outputDir: outputDir.trim(),
      // 渠道按分组取，这里只给 id：条目由主进程回磁盘读，分组文件才是权威，
      // 界面上的那份可能已经过期（渠道配置页刚改过）。
      groupId,
    }
    // 不带 jks 就只能跳过签名（switchToNoJks 已经把 signMode 落成 skip）
    return noJks ? { ...base, signMode: 'skip' } : { ...base, jksId }
  }

  /** 用一份明确给定的参数出包。表单那条路与「自定义渠道导出」那条路共用 */
  const startWith = async (params: TaskInput): Promise<void> => {
    setStatus(null)
    // 单次出包的结果归单次结果卡片，别让队列卡片去认领
    setRanQueue(false)
    // 单次出包不排队，进度标题上不该留着「第 N/M 项」
    setQueueProgress(null)
    await start(params)
  }

  const handleStart = async (): Promise<void> => {
    await startWith(currentParams())
  }

  /*
   * 自定义渠道导出：确认后拿弹窗里那份列表直接出包。
   *
   * 两条独立的动作，顺序不能反：先把勾中的条目并进分组，再出包。反过来的话，
   * 分组写失败就会留下一个「包已经出了、但没落盘」的错觉 —— 而落盘失败是必须
   * 让人看见的。
   *
   * 注意这里绕开了表单的 blockers：没有分组、分组里没条目都不该挡住这条路，
   * 它本来就是给「临时打几个渠道」用的。但 APK 与输出目录仍然要齐。
   */
  const handleCustomConfirm = async (payload: CustomChannelExportPayload): Promise<void> => {
    if (apkPath.trim() === '' || outputDir.trim() === '') {
      setStatus({ kind: 'error', text: '先选好 APK 与输出目录，再用自定义渠道出包。' })
      return
    }
    setCustomBusy(true)
    try {
      if (payload.rowsToSave.length > 0 && payload.groupId !== '') {
        const existing = await getChannels(payload.groupId)
        await saveChannels(payload.groupId, {
          channelInfoList: [...existing.channelInfoList, ...payload.rowsToSave],
        })
        if (payload.groupId === groupId) {
          setChannels((previous) => [...previous, ...payload.rowsToSave])
          setPicked((previous) => {
            const next = new Set(previous)
            for (const entry of payload.rowsToSave) {
              next.add(entry.channel)
            }
            return next
          })
        }
      }
      setCustomOpen(false)
      const base: TaskInput = {
        apkPath: apkPath.trim(),
        // 渠道来源 B：这份列表只存在于这次出包里
        channelInfoList: payload.channels,
        channelCodes: payload.channels.map((entry) => entry.channel),
        signMode,
        outputDir: outputDir.trim(),
      }
      await startWith(noJks ? { ...base, signMode: 'skip' } : { ...base, jksId })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setCustomBusy(false)
    }
  }

  /*
   * 把一份参数填回表单，不立刻开跑：同一份包换个渠道、换个输出目录再跑是常见动作，
   * 直接开跑会让人来不及改。
   *
   * 单次出包的「重跑本次」与队列某一项的「重跑本次」都走这里 —— 要填的东西完全
   * 一样，分开写迟早改歪一处。
   *
   * 勾选要分两条路走 —— 换了分组的话，下面读渠道列表那个 effect 会重跑并把勾选
   * 重置成全选，所以得把要恢复的勾选交给它；没换分组时它不会跑，直接套用。
   */
  const applyParams = (params: TaskInput, note: string) => {
    const targetJksId = params.jksId ?? ''
    const targetGroupId = params.groupId ?? ''
    setApkPath(params.apkPath)
    setSignMode(params.signMode)
    setOutputDir(params.outputDir)
    setNoJks(targetJksId === '')
    setJksId(targetJksId)

    const restored = params.channelInfoList
    if (restored) {
      /*
       * 上次走的是「自定义渠道导出」：那份列表只存在于那一次运行里（没落盘），
       * 而且它不是任何分组的内容 —— 填回表单只会让人以为要出分组的渠道。
       * 所以把弹窗连同那份列表一起打开，让人看一眼再确认。
       */
      setCustomInitial({ channels: restored })
      setCustomOpen(true)
      setStatus({ kind: 'ok', text: '上次用的是自定义渠道，已把那份列表放回弹窗。' })
      return
    }

    if (targetGroupId === groupId) {
      const available = new Set(channels.map((entry) => entry.channel))
      setPicked(new Set(params.channelCodes.filter((code) => available.has(code))))
    } else {
      pendingPickedRef.current = params.channelCodes
    }
    setGroupId(targetGroupId)
    setStatus({ kind: 'ok', text: note })
  }

  const handleRerun = () => {
    if (!lastRun) {
      return
    }
    applyParams(lastRun, '已把上次出包的参数填回上面，确认后点「开始出包」。')
  }

  /** 队列某项的「详情」里点「填回表单」：用这一项的参数，不立刻开跑 */
  const handleQueueRerun = (item: QueueItem) => {
    applyParams(item.params, `已把「${item.apkName}」的参数填回上面，确认后点「开始出包」。`)
  }

  /*
   * 打开目录或日志交给系统资源管理器。路径可能已经被手工挪走或删掉，
   * 所以主进程把「打不开」当返回值给（成功是空串），这里只判空串。
   */
  const handleOpenPath = async (target: string, what: string): Promise<void> => {
    if (target === '') {
      setStatus({ kind: 'error', text: `没有可打开的${what}。` })
      return
    }
    try {
      const error = await window.api.openPath(target)
      if (error !== '') {
        setStatus({ kind: 'error', text: `打不开${what}：${error}` })
      }
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  const channelKeyword = channelQuery.trim().toLowerCase()
  const searching = channelKeyword !== ''
  /*
   * 搜索只影响「看得见什么」，不动勾选本身 —— 搜完再点全选，勾的是筛出来的那几条，
   * 而不是把看不见的也一起改了。
   */
  const visibleChannels = useMemo(() => {
    if (!searching) {
      return channels
    }
    return channels.filter(
      (entry) =>
        entry.channel.toLowerCase().includes(channelKeyword) ||
        (entry.alias ?? '').toLowerCase().includes(channelKeyword),
    )
  }, [channels, searching, channelKeyword])
  const visibleAllPicked =
    visibleChannels.length > 0 && visibleChannels.every((entry) => picked.has(entry.channel))
  const blockers = useMemo(() => {
    const list: string[] = []
    if (!apkPath.trim()) {
      list.push('尚未选择 APK')
    }
    if (!noJks && !selectedJks) {
      list.push('尚未选择签名文件')
    }
    if (groups.length === 0) {
      list.push('还没有分组')
    } else if (!selectedGroup) {
      list.push('尚未选择分组')
    } else if (channels.length === 0) {
      list.push('这个分组还没有渠道条目')
    } else if (picked.size === 0) {
      list.push('尚未勾选任何渠道')
    }
    if (!outputDir.trim()) {
      list.push('尚未设置输出目录')
    }
    return list
  }, [
    apkPath,
    noJks,
    selectedJks,
    groups.length,
    selectedGroup,
    channels.length,
    picked.size,
    outputDir,
  ])

  const canStart = blockers.length === 0 && !running && !queueRunning

  /*
   * 「加入队列」把当前表单的参数存成一项。队列是当时的意图的快照 ——
   * 之后改表单、改 jks 名字都不该动它，否则排队排到一半内容就变了。
   */
  const handleEnqueue = () => {
    if (blockers.length > 0) {
      setStatus({ kind: 'error', text: `还差：${blockers.join('、')}` })
      return
    }
    const params = currentParams()
    const item: QueueItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      params,
      apkName: baseNameOf(params.apkPath),
      jksName: noJks ? '不用签名文件' : (selectedJks?.displayName ?? jksId),
      groupName: selectedGroup?.name ?? '',
      status: 'pending',
    }
    setQueue((previous) => [...previous, item])
    setStatus({ kind: 'ok', text: `已加入队列（第 ${queue.length + 1} 项），点「开始队列」可批量出包。` })
    /*
     * 队列卡片在页面最下面，加完不滚过去的话，屏幕上什么也没变 ——
     * 人只会再点一次「加入队列」，然后队列里出现两项一模一样的。
     */
    requestAnimationFrame(() => {
      queueCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  /*
   * 串行跑队列。
   *
   * 单项失败只标它自己，循环照常往下走 —— 一批里坏一个就全停，等于把「批量」
   * 这件事废掉了。
   *
   * 等结果这件事交给 TaskProvider 的 runAndWait：它把「等结果」的钩子在启动任务
   * 之前就挂好了（流水线在校验阶段就失败时，带 result 的进度事件可能比 runTask
   * 的返回值先到，钩子挂晚了这一项会永远停在「出包中」，打包态实测踩到过）。
   */
  const handleStartQueue = async (): Promise<void> => {
    const pending = queue.filter((item) => item.status === 'pending')
    if (pending.length === 0) {
      setStatus({ kind: 'error', text: '队列里没有待出包的任务。' })
      return
    }
    setStatus(null)
    setRanQueue(true)
    setQueueRunning(true)
    let ok = 0
    let bad = 0
    let index = 0
    let cancelled = false
    for (const item of pending) {
      index += 1
      // 队列跑起来之后人最想知道的是「还剩几项」，光看单项阶段看不出来
      setQueueProgress({ index, total: pending.length })
      setQueue((previous) =>
        previous.map((row) => (row.id === item.id ? { ...row, status: 'running' } : row)),
      )
      const { result: outcome, startError } = await runAndWait(item.params)
      if (outcome === null) {
        // runTask 自己就抛了错（还没轮到流水线），这时没有结果卡片可看，只记一句
        bad += 1
        setQueue((previous) =>
          previous.map((row) =>
            row.id === item.id
              ? { ...row, status: 'failed', error: startError || '未能取得本次出包的结果' }
              : row,
          ),
        )
      } else if (outcome.ok) {
        ok += 1
        setQueue((previous) =>
          previous.map((row) => (row.id === item.id ? { ...row, status: 'done', result: outcome } : row)),
        )
      } else {
        bad += 1
        setQueue((previous) =>
          previous.map((row) =>
            row.id === item.id ? { ...row, status: 'failed', result: outcome } : row,
          ),
        )
        /*
         * 取消不是「这一项失败」，是「这一批不做了」。
         * 接着跑下一项等于把人的取消当成耳边风，所以停在这里，剩下的留在
         * 「待出包」状态 —— 想接着跑再点一次「开始队列」就行。
         */
        if (outcome.failure?.cancelled === true) {
          cancelled = true
          break
        }
      }
    }
    setQueueRunning(false)
    setQueueProgress(null)
    // 队列的逐项结果在队列卡片里看，别让最后一项又占一张单次出包的结果卡片
    resetTask()
    const remaining = pending.length - ok - bad
    setStatus(
      cancelled
        ? {
            kind: 'warning',
            text: `已取消。这次跑完 ${ok + bad} 项（成功 ${ok} 项，失败 ${bad} 项），还剩 ${remaining} 项没有开始。`,
          }
        : {
            // 全成走 ok；一项都没成是 error；成了一些是 warning（可继续，但要留意）
            kind: bad === 0 ? 'ok' : ok === 0 ? 'error' : 'warning',
            text:
              `队列执行完毕：成功 ${ok} 项，失败 ${bad} 项。` +
              (bad > 0 ? '失败项可点「详情」查看诊断信息。' : ''),
          },
    )
  }

  /** 选一个输出目录。用户取消时 pickDirectory 回 null，这时保持原值不动 */
  const handlePickOutputDir = async (): Promise<void> => {
    try {
      const chosen = await window.api.pickDirectory('选择输出目录', outputDir.trim())
      if (chosen !== null) {
        setOutputDir(chosen)
        setStatus(null)
      }
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /** 真的清空。走完二次确认才到这里 */
  const confirmClearQueue = () => {
    setClearQueueOpen(false)
    setQueue([])
    setStatus({ kind: 'ok', text: '队列已清空。' })
  }

  /*
   * 单项移除给一次「撤销」。
   *
   * 移除按钮就挨着「详情」，手一抖点错整项就没了 —— 而重新加一遍要回表单重挑
   * APK 和分组。记下它原来在第几位，撤销时放回原位。
   */
  const handleRemoveQueueItem = (id: string) => {
    const index = queue.findIndex((item) => item.id === id)
    if (index < 0) {
      return
    }
    const removed = queue[index]
    setQueue((previous) => previous.filter((item) => item.id !== id))
    toast.info(`已从队列移除第 ${index + 1} 项。`, {
      action: {
        label: '撤销',
        onClick: () => {
          setQueue((previous) => {
            if (previous.some((item) => item.id === removed.id)) {
              return previous
            }
            const next = [...previous]
            next.splice(Math.min(index, next.length), 0, removed)
            return next
          })
        },
      },
    })
  }

  /** 把一项退回「待出包」：参数原样留着，不用回表单重填 */
  const handleRetryQueueItem = (id: string) => {
    setQueue((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, status: 'pending', result: undefined, error: undefined } : item,
      ),
    )
  }

  const handleRetryFailedQueue = () => {
    const count = queue.filter((item) => item.status === 'failed').length
    if (count === 0) {
      return
    }
    setQueue((previous) =>
      previous.map((item) =>
        item.status === 'failed'
          ? { ...item, status: 'pending', result: undefined, error: undefined }
          : item,
      ),
    )
    setStatus({ kind: 'ok', text: `已把 ${count} 个失败项退回「待出包」，点「开始队列」重跑。` })
  }

  /** 调整执行顺序 —— 队列就是按这个顺序跑的，也就是「先出哪个包」 */
  const handleMoveQueueItem = (id: string, direction: -1 | 1) => {
    setQueue((previous) => {
      const index = previous.findIndex((item) => item.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= previous.length) {
        return previous
      }
      const next = [...previous]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  /*
   * 失败后那句「接下来怎么办」上的按键。
   *
   * 只把人送到该改的地方，不替他改任何值 —— 换哪份签名文件、换哪个目录，
   * 只有他自己知道。
   */
  const handleFix = (action: FixAction) => {
    if (action === 'jks') {
      go('jks')
      return
    }
    if (action === 'apk') {
      setStatus({ kind: 'warning', text: '重新选择 APK：点上面的「选择 APK」，或把文件拖进来。' })
      return
    }
    setStatus({ kind: 'warning', text: '换一个输出目录：点「选择目录」挑一个能写的目录再试。' })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="勾选渠道后生成渠道包，产物名为 <原包名>_<别名>.apk。渠道来自「渠道配置」中的分组；只有别人签好的包、没有私钥时，签名选「不用签名文件」即可只写渠道、不重新签名。" />

      <Card>
        <CardHeader>
          <CardTitle>输入 APK</CardTitle>
          <CardDescription>拖入文件，或使用右侧按钮选择。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              handleApk(event.dataTransfer.files[0])
            }}
            className={
              dragging
                ? 'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-ring bg-muted/50 px-4 py-8 text-center'
                : 'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center'
            }
          >
            <Package className="size-6 text-muted-foreground" />
            <p className="text-sm">将 APK 拖到此处。</p>
            <label className="cursor-pointer">
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted active:bg-muted/70">
                <Upload className="size-4" />
                选择 APK
              </span>
              <input
                type="file"
                accept=".apk"
                className="hidden"
                onChange={(event) => {
                  handleApk(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="apk-path">APK 路径</Label>
            <div className="flex items-center gap-2">
              <Input
                id="apk-path"
                value={apkPath}
                onChange={(event) => {
                  setApkPath(event.target.value)
                  setOutputDir(defaultOutputDir(event.target.value))
                }}
                placeholder="拖入或选择后自动填入"
              />
              <Button
                variant="outline"
                onClick={handleShowChannel}
                disabled={showing || apkPath.trim() === ''}
                title={apkPath.trim() === '' ? '先选择 APK' : '读取这个包的渠道号'}
              >
                <Eye />
                查看渠道
              </Button>
            </div>
            {sourceCheck ? (
              <p
                className={
                  sourceCheck.ok
                    ? 'text-xs text-muted-foreground'
                    : 'text-xs text-destructive'
                }
              >
                {sourceCheck.message}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>签名与渠道</CardTitle>
          <CardDescription>
            {noJks
              ? '不使用签名文件：只写入渠道信息，签名保持原样。'
              : selectedJks
                ? `签名文件别名 ${selectedJks.alias}`
                : '请选择一个签名文件。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pack-jks">签名文件</Label>
              <Select value={noJks ? NO_JKS : jksId} onValueChange={handlePickJks}>
                <SelectTrigger id="pack-jks">
                  <SelectValue placeholder="请选择签名文件" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_JKS}>不用签名文件（只写渠道，不重新签名）</SelectItem>
                  {jksItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.displayName}（{item.id}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pack-sign-mode">签名模式</Label>
              <Select value={signMode} onValueChange={handlePickSignMode}>
                <SelectTrigger id="pack-sign-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* 没有 jks 就没有私钥，重签名这一项选不了；jks 下拉里选回一个就会解开 */}
                  <SelectItem value="sign" disabled={jksItems.length === 0}>
                    重新签名（对齐安装包并重新签名）
                  </SelectItem>
                  <SelectItem value="skip">跳过签名（不重新签名，仅核对原包签名）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pack-group">渠道分组</Label>
            <div className="flex items-center gap-2">
              <GroupPicker
                id="pack-group"
                groups={groupOptions}
                value={groupId}
                onChange={handlePickGroup}
                disabled={groups.length === 0}
                className="w-56"
              />
              <Button variant="outline" size="sm" onClick={() => go('channels')}>
                <ListPlus />
                管理分组
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCustomInitial(null)
                  setCustomOpen(true)
                }}
              >
                自定义渠道导出
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {groups.length === 0
                ? '还没有分组。渠道列表按分组存储，请先到「渠道配置」创建一个。'
                : '出包时写入这个分组里的渠道。切换签名文件时，会回到该签名文件上次使用的分组。'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pack-output">输出目录</Label>
            <div className="flex items-center gap-2">
              <Input
                id="pack-output"
                value={outputDir}
                onChange={(event) => setOutputDir(event.target.value)}
                placeholder="默认 <APK 同级>\渠道包"
              />
              {/*
               * 目录只让人手打一串 `D:\...` 太容易错：中文路径、反斜杠、末尾空格
               * 都要到出包时才暴露。给个选择器，手打仍然保留。
               */}
              <Button
                variant="outline"
                onClick={() => void handlePickOutputDir()}
                title="选择一个文件夹作为输出目录"
              >
                <FolderOpen />
                选择目录
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                渠道（已勾选 {picked.size} / {channels.length}
                {searching ? `，显示 ${visibleChannels.length} 条` : ''}）
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPicked((previous) => {
                    const next = new Set(previous)
                    // 有搜索词时只动「筛出来的那些」：看不见的行不该被顺手改掉
                    for (const entry of visibleChannels) {
                      if (visibleAllPicked) {
                        next.delete(entry.channel)
                      } else {
                        next.add(entry.channel)
                      }
                    }
                    return next
                  })
                }
                disabled={visibleChannels.length === 0}
                title={
                  searching
                    ? '只动搜索筛出来的这些；键盘上按 Ctrl+A 同样效果'
                    : '全部勾上或全部取消；键盘上按 Ctrl+A 同样效果'
                }
              >
                {visibleAllPicked
                  ? searching
                    ? '取消勾选显示中的'
                    : '全不选'
                  : searching
                    ? `勾选显示中的 ${visibleChannels.length} 条`
                    : '全选'}
              </Button>
            </div>
            {channels.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>这个分组还没有渠道条目。</span>
                <Button variant="outline" size="sm" onClick={() => go('channels')}>
                  去「渠道配置」
                </Button>
              </div>
            ) : (
              <>
                {/*
                 * 分组里几十上百条渠道时，光靠肉眼在网格里找太难 —— 按别名或渠道号搜。
                 * 全选按钮跟着搜索走，勾的只是看得见的那几条。
                 */}
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={channelQuery}
                    onChange={(event) => setChannelQuery(event.target.value)}
                    placeholder="搜索别名或渠道号"
                    aria-label="搜索渠道"
                    className="pl-8"
                  />
                </div>
                {visibleChannels.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>没有匹配「{channelQuery.trim()}」的渠道。</span>
                    <Button variant="outline" size="sm" onClick={() => setChannelQuery('')}>
                      清空搜索
                    </Button>
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-2 gap-2 md:grid-cols-3"
                    onKeyDown={handleChannelGridKeyDown}
                  >
                    {visibleChannels.map((entry, index) => {
                      const alias = entry.alias?.trim()
                      // 别名是给人看的，渠道号是实际写进包里的，两个都要能看见：
                      // 只显示别名时，两条别名相近的渠道分不出哪条是哪条。
                      return (
                        <label
                          key={entry.channel}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                            /*
                             * 选中态给整块上色，而不是只靠那个小方框 —— 一屏几十条渠道时，
                             * 勾选框太小，扫一眼数不清勾了哪些。hover 与按下共用一套底色，
                             * 只有深浅差别，鼠标移开时不会跳变。
                             */
                            picked.has(entry.channel)
                              ? 'border-primary/40 bg-primary/5'
                              : 'hover:bg-muted/50 active:bg-muted',
                          )}
                          onClick={(event) => handleChannelShiftClick(event, index)}
                        >
                          <Checkbox
                            checked={picked.has(entry.channel)}
                            onCheckedChange={(value) => toggleChannel(entry.channel, value === true)}
                            aria-label={entry.channel}
                          />
                          {/*
                           * 别名与渠道号并排，而不是上下两行。
                           *
                           * 上下两行时，只有「有别名」的条目占两行、其余占一行，网格里每块
                           * 矩形的高度就参差不齐 —— Material 的列表规范要求同一列表里各行的
                           * 内容结构相似、元素落在一致的位置，横排正好满足。
                           * 字号不同，所以按基线对齐，视觉上坐在同一条线上。
                           */}
                          <span className="flex min-w-0 items-baseline gap-1.5 leading-tight">
                            <span
                              className="shrink-0"
                              title={alias ? `${alias}（${entry.channel}）` : entry.channel}
                            >
                              {alias || entry.channel}
                            </span>
                            {alias ? (
                              <span
                                className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                                title={entry.channel}
                              >
                                {entry.channel}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {status ? (
        <p
          className={
            status.kind === 'error'
              ? 'text-sm text-destructive'
              : status.kind === 'warning'
                ? 'text-sm text-warning'
                : 'text-sm text-success'
          }
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      ) : null}

      <ProgressPanel
        stage={stage}
        flow={flow}
        lines={lines}
        queueProgress={queueProgress}
        failed={result !== null && !result.ok}
      />

      {result && !ranQueue ? (
        <TaskResultCard
          result={result}
          onOpenPath={handleOpenPath}
          onRerun={handleRerun}
          rerunDisabled={lastRun === null || running || queueRunning}
          onFix={handleFix}
        />
      ) : null}

      {queue.length > 0 ? (
        <div ref={queueCardRef}>
          <PackQueueCard
            items={queue}
            running={queueRunning}
            onStart={() => void handleStartQueue()}
            onClear={() => setClearQueueOpen(true)}
            onRemove={handleRemoveQueueItem}
            onRetry={handleRetryQueueItem}
            onRetryFailed={handleRetryFailedQueue}
            onMove={handleMoveQueueItem}
            onRerun={handleQueueRerun}
            onOpenPath={handleOpenPath}
          />
        </div>
      ) : null}

      {/*
        跑完的结果原来只留最近一次：出完一批回头想确认「第几个包出成没有」，
        屏幕上已经换成别的了。留在内存里回看，不落盘 —— 关掉窗口就该是干净的。
      */}
      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <History />
              最近结果
              <Badge variant="outline">{history.length} 次</Badge>
            </CardTitle>
            <CardDescription>
              最近 10 次出包的结果，新的在最上面；关掉窗口就没了。逐项结果在「出包队列」里看。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(historyOpen ? history : history.slice(0, 3)).map((entry) => (
              <div key={entry.at} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {clockOf(entry.at)}
                </span>
                <Badge variant={entry.result.ok ? 'success' : 'destructive'}>
                  {entry.result.ok ? '成功' : '失败'}
                </Badge>
                <span className="min-w-0 break-words">{entry.result.message}</span>
              </div>
            ))}
            {history.length > 3 ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHistoryOpen((previous) => !previous)}
                  aria-expanded={historyOpen}
                >
                  {historyOpen ? <ChevronDown /> : <ChevronRight />}
                  {historyOpen ? '只看最近 3 次' : `展开其余 ${history.length - 3} 次`}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/*
        主操作原来在长页面最底部：渠道网格一多，想点「开始出包」就得先滚到底，
        滚到底又看不见上面填的对不对。放到最后一个视觉元素上并吸住滚动容器底部，
        滚动时它一直可点；结果、队列这些反馈都排在它上面，不会被挡住。
        负边距是为了让它贴到滚动区左右与底边，看着像一条固定的操作栏。
      */}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center gap-3 border-t bg-background px-6 py-3">
        <Button onClick={() => void handleStart()} disabled={!canStart}>
          {running ? <Spinner /> : null}
          {running ? '出包中…' : '开始出包'}
        </Button>
        <Button variant="outline" onClick={handleEnqueue} disabled={!canStart}>
          <ListPlus />
          加入队列
        </Button>
        {blockers.length > 0 ? (
          <span className="text-sm text-muted-foreground">还差：{blockers.join('、')}</span>
        ) : null}
      </div>

      {/*
        清空是整队一次丢光，而队列里的参数没有别的地方存着 —— 重新加一遍要回表单
        重挑 APK 与分组。所以先问一句，并把「会丢掉多少」写在明面上。
      */}
      <ConfirmDialog
        open={clearQueueOpen}
        onOpenChange={setClearQueueOpen}
        title="清空整个队列？"
        description={`队列里 ${queue.length} 项会一起消失。`}
        warning={`其中 ${queue.filter((item) => item.status === 'pending').length} 项尚未执行 —— 这些参数没有其他副本，需要回到表单重新选择 APK 与分组。已经出好的包不受影响。`}
        confirmText="清空队列"
        destructive
        onConfirm={confirmClearQueue}
      />

      <CustomChannelExportDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        groups={groupOptions}
        defaultGroupId={groupId}
        initial={customInitial}
        busy={customBusy}
        onConfirm={(payload) => void handleCustomConfirm(payload)}
        onGoChannels={() => {
          setCustomOpen(false)
          go('channels')
        }}
      />

      <Dialog
        open={showing || showResult !== null}
        onOpenChange={(open) => {
          if (!open) {
            setShowResult(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>查看渠道</DialogTitle>
            <DialogDescription>
              {showTarget ? `读取 ${baseNameOf(showTarget)} 的渠道信息。` : '读取包的渠道信息。'}
            </DialogDescription>
          </DialogHeader>

          {showing ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Spinner />
              读取中…
            </p>
          ) : showResult === null ? null : !showResult.ok ? (
            <p className="text-sm text-destructive">
              读取渠道信息失败：{showResult.message}
            </p>
          ) : (showResult.channel ?? '') === '' ? (
            <p className="text-sm text-muted-foreground">
              这个包没有渠道信息，说明尚未写入过渠道。
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">渠道号</span>
                <span className="break-all font-mono">
                  {showResult.channel && showResult.channel !== '' ? showResult.channel : '(空)'}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResult(null)} disabled={showing}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
