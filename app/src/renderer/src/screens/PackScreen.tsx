import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, ListPlus, Package, Upload } from 'lucide-react'
import {
  CustomChannelExportDialog,
  type CustomChannelExportPayload,
} from '@/components/CustomChannelExportDialog'
import { PageHeader } from '@/components/PageHeader'
import { PackQueueCard, type QueueItem } from '@/components/PackQueueCard'
import { ProgressPanel } from '@/components/ProgressPanel'
import { TaskResultCard } from '@/components/TaskResultCard'
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
import type { SignMode, SourceCheckResult, TaskInput, TaskResult, WalleShowResult } from '@shared/types/task'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { NO_JKS_KEY, readLastGroup, writeLastGroup } from '@/lib/last-group'
import { STAGE_LABELS } from '@/lib/task-report'
import { useAppStore } from '@/store/app-store'
import { useNav } from '@/store/nav'

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

/**
 * Radix Select 不接受空串当 value，所以用这个哨兵表示「不用 jks」。
 * 真值不放 '' 是因为 '' 同时被用作「还没选」，两个意思混在一起会打架。
 */
const NO_JKS = '__none__'

export function PackScreen() {
  const { groups, jksItems, getChannels, saveChannels, initialized } = useAppStore()
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

  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<TaskResult | null>(null)
  /** 本次出包用的参数，供结果卡片上的「重跑本次」填回表单 */
  const [lastRun, setLastRun] = useState<TaskInput | null>(null)
  /** 批量出包的队列。空数组时整个队列卡片不渲染 */
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [queueRunning, setQueueRunning] = useState(false)
  /** 上一次出包是不是「开始队列」发起的 —— 决定结果卡片归谁渲染 */
  const [ranQueue, setRanQueue] = useState(false)
  /** 「自定义渠道导出」弹窗 */
  const [customOpen, setCustomOpen] = useState(false)
  const [customBusy, setCustomBusy] = useState(false)
  /** 「重跑本次」时把上次那份自定义列表放回弹窗；null = 从空开始 */
  const [customInitial, setCustomInitial] = useState<{
    channels: ChannelEntry[]
  } | null>(null)
  // null 表示「本界面还没启动过任务」；此时到达的进度一定属于本次启动
  const taskIdRef = useRef<string | null>(null)
  // 队列在等这一项的最终结果。进度事件带 result 时把它叫醒，循环才往下走；
  // runTask 自己抛错时没人叫醒，所以参数允许 null 表示「这一项没结果」。
  const queueResolveRef = useRef<((result: TaskResult | null) => void) | null>(null)
  // 「重跑本次」要恢复的勾选。渠道列表是异步读的，得等读完再套用，
  // 否则会被读盘那一步的「默认全选」盖掉。
  const pendingPickedRef = useRef<string[] | null>(null)

  useEffect(() => {
    const unsubscribe = window.api.onTaskProgress((event) => {
      const current = taskIdRef.current
      if (current !== null && event.taskId !== current) {
        return
      }
      setStage(STAGE_LABELS[event.stage])
      if (event.line !== undefined && event.line !== '') {
        setLines((previous) => [...previous.slice(-499), event.line as string])
      } else if (event.message !== '') {
        setLines((previous) => [...previous.slice(-499), `— ${event.message}`])
      }
      if (event.result) {
        setResult(event.result)
        setRunning(false)
        // 队列在等这一项跑完；叫醒它，否则循环会一直停在 await 上
        const resolve = queueResolveRef.current
        if (resolve !== null) {
          queueResolveRef.current = null
          resolve(event.result)
        }
      }
    })
    return unsubscribe
  }, [])

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

  useEffect(() => {
    if (groupId === '') {
      setChannels([])
      setPicked(new Set())
      return
    }
    let cancelled = false
    getChannels(groupId)
      .then((config) => {
        if (cancelled) {
          return
        }
        setChannels(config.channelInfoList)
        const codes = config.channelInfoList.map((entry) => entry.channel)
        const pending = pendingPickedRef.current
        if (pending === null) {
          setPicked(new Set(codes))
          return
        }
        // 「重跑本次」恢复的勾选：只留这个分组里还存在的渠道，
        // 上一次跑完到现在的这段时间里渠道可能已经被删掉了。
        pendingPickedRef.current = null
        const available = new Set(codes)
        setPicked(new Set(pending.filter((code) => available.has(code))))
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
    setLines([])
    setResult(null)
    setStatus(null)
    setStage('启动中')
    setRanQueue(false)
    taskIdRef.current = null
    setRunning(true)
    // 先记下这次用的参数，跑完能在结果卡片上「重跑本次」
    setLastRun(params)
    try {
      const started = await window.api.runTask(params)
      taskIdRef.current = started.taskId
    } catch (error) {
      setRunning(false)
      setStage('失败')
      setLines([ipcErrorMessage(error)])
    }
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
   * 「重跑本次」只把参数填回表单，不立刻开跑：同一份包换个渠道、换个输出目录再跑
   * 是常见动作，直接开跑会让人来不及改。
   *
   * 勾选要分两条路走 —— 换了分组的话，下面读渠道列表那个 effect 会重跑并把勾选
   * 重置成全选，所以得把要恢复的勾选交给它；没换分组时它不会跑，直接套用。
   */
  const handleRerun = () => {
    if (!lastRun) {
      return
    }
    const targetJksId = lastRun.jksId ?? ''
    const targetGroupId = lastRun.groupId ?? ''
    setApkPath(lastRun.apkPath)
    setSignMode(lastRun.signMode)
    setOutputDir(lastRun.outputDir)
    setNoJks(targetJksId === '')
    setJksId(targetJksId)

    const restored = lastRun.channelInfoList
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
      setPicked(new Set(lastRun.channelCodes.filter((code) => available.has(code))))
    } else {
      pendingPickedRef.current = lastRun.channelCodes
    }
    setGroupId(targetGroupId)
    setStatus({ kind: 'ok', text: '已把上次出包的参数填回上面，确认后点「开始出包」。' })
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

  const allPicked = channels.length > 0 && picked.size === channels.length
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
  }

  /*
   * 串行跑队列。
   *
   * 单项失败只标它自己，循环照常往下走 —— 一批里坏一个就全停，等于把「批量」
   * 这件事废掉了。结果要等进度事件带 result 才拿得到（runTask 只回 taskId），
   * 所以用 queueResolveRef 把这一项挂起，进度回调来叫醒。
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
    setRunning(true)
    let ok = 0
    let bad = 0
    for (const item of pending) {
      setLines([])
      setResult(null)
      setStage('启动中')
      setQueue((previous) =>
        previous.map((row) => (row.id === item.id ? { ...row, status: 'running' } : row)),
      )
      /*
       * 先把「等结果」的钩子挂上，再启动任务。
       *
       * 反过来写会漏事件：流水线在「校验输入」阶段就失败时几乎立刻返回，那条带
       * result 的进度事件可能比 runTask 的返回值先到，那时钩子还没挂上，这一项
       * 就会永远停在「出包中」（打包态实测踩到过）。
       * taskIdRef 仍要先清成 null，否则新任务的进度会被上一项的 taskId 过滤掉。
       */
      const waited = new Promise<TaskResult | null>((resolve) => {
        queueResolveRef.current = resolve
      })
      taskIdRef.current = null
      let failureText = ''
      try {
        const started = await window.api.runTask(item.params)
        taskIdRef.current = started.taskId
      } catch (error) {
        failureText = ipcErrorMessage(error)
        // runTask 自己就抛了错，不会有结果事件来叫醒，这里手动收尾
        const resolve = queueResolveRef.current
        queueResolveRef.current = null
        if (resolve !== null) {
          resolve(null)
        }
      }
      const outcome = await waited
      if (outcome === null) {
        // runTask 自己就抛了错（还没轮到流水线），这时没有结果卡片可看，只记一句
        bad += 1
        setQueue((previous) =>
          previous.map((row) =>
            row.id === item.id
              ? { ...row, status: 'failed', error: failureText || '未能取得本次出包的结果' }
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
      }
    }
    setQueueRunning(false)
    setRunning(false)
    setStage(null)
    // 队列的逐项结果在队列卡片里看，别让最后一项又占一张单次出包的结果卡片
    setResult(null)
    setStatus({
      // 全成走 ok；一项都没成是 error；成了一些是 warning（可继续，但要留意）
      kind: bad === 0 ? 'ok' : ok === 0 ? 'error' : 'warning',
      text:
        `队列执行完毕：成功 ${ok} 项，失败 ${bad} 项。` +
        (bad > 0 ? '失败项可点「详情」查看诊断信息。' : ''),
    })
  }

  const handleClearQueue = () => {
    setQueue([])
    setStatus({ kind: 'ok', text: '队列已清空。' })
  }

  const handleRemoveQueueItem = (id: string) => {
    setQueue((previous) => previous.filter((item) => item.id !== id))
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="勾选渠道后生成渠道包，产物名为 <原包名>_<别名>.apk。渠道来自「渠道配置」中的分组；手上只有别人签好的包、没有私钥时，签名选「不用签名文件」即可只写渠道、不重新签名。" />

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
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
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
                disabled={showing}
                title="读取这个包的渠道号"
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
              <Select value={groupId} onValueChange={handlePickGroup} disabled={groups.length === 0}>
                <SelectTrigger id="pack-group">
                  <SelectValue placeholder="请选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.appLabel ? `${item.name}（${item.appLabel}）` : item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Input
              id="pack-output"
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              placeholder="默认 <APK 同级>\渠道包"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                渠道（已勾选 {picked.size} / {channels.length}）
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPicked(allPicked ? new Set() : new Set(channels.map((entry) => entry.channel)))
                }
                disabled={channels.length === 0}
              >
                {allPicked ? '全不选' : '全选'}
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
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {channels.map((entry) => {
                  const alias = entry.alias?.trim()
                  // 别名是给人看的，渠道号是实际写进包里的，两个都要能看见：
                  // 只显示别名时，两条别名相近的渠道分不出哪条是哪条。
                  return (
                    <label
                      key={entry.channel}
                      className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <Checkbox
                        checked={picked.has(entry.channel)}
                        onCheckedChange={(value) => toggleChannel(entry.channel, value === true)}
                        aria-label={entry.channel}
                      />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate" title={alias ? `${alias}（${entry.channel}）` : entry.channel}>
                          {alias || entry.channel}
                        </span>
                        {alias ? (
                          <span
                            className="truncate font-mono text-xs text-muted-foreground"
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
        >
          {status.text}
        </p>
      ) : null}

      <ProgressPanel stage={stage} lines={lines} />

      <div className="flex flex-wrap items-center gap-3">
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

      {result && !ranQueue ? (
        <TaskResultCard
          result={result}
          onOpenPath={handleOpenPath}
          onRerun={handleRerun}
          rerunDisabled={lastRun === null || running || queueRunning}
        />
      ) : null}

      {queue.length > 0 ? (
        <PackQueueCard
          items={queue}
          running={queueRunning}
          onStart={() => void handleStartQueue()}
          onClear={handleClearQueue}
          onRemove={handleRemoveQueueItem}
          onOpenPath={handleOpenPath}
        />
      ) : null}

      <CustomChannelExportDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        groups={groups}
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
