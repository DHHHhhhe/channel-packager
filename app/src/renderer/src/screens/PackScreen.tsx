import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Eye, FileText, FolderOpen, Package, RotateCcw, Upload } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { ProgressPanel } from '@/components/ProgressPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ChannelEntry } from '@shared/types/store'
import type { SignMode, TaskInput, TaskResult, TaskStage, WalleShowResult } from '@shared/types/task'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

const STAGE_LABELS: Record<TaskStage, string> = {
  validate: '校验输入',
  prepare: '准备工作目录',
  'check-source': '核对输入包签名',
  align: 'zipalign 对齐',
  sign: 'apksigner 重签名',
  'verify-sign': '校验签名',
  rename: '还原为原包名',
  'resigned-copy': '另存已签名未写渠道的包',
  'channel-json': '写渠道配置',
  walle: 'walle 写渠道',
  check: '校验产物渠道号',
  publish: '移动到输出目录',
  done: '完成',
  failed: '失败',
}

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
 * 拼出「复制诊断信息」的内容。
 *
 * 只放定位问题用得上的东西，不塞组件版本 —— 收件人真正要看的是卡在哪一步、
 * 退出码多少、那一步说了什么。家目录的脱敏不在这里做：主进程写剪贴板时按
 * `os.homedir()` 精确替换（见 app/src/main/ipc/clipboard.ts），
 * 比在这儿拿正则猜路径长什么样可靠（用户名带空格时会猜错）。
 */
function buildDiagnostic(result: TaskResult): string {
  const failure = result.failure
  const lines: string[] = [
    '渠道分包工具 · 出包失败',
    `任务号：${result.taskId}`,
    `失败步骤：${failure ? STAGE_LABELS[failure.stage] : '未知'}`,
    `原因：${result.message}`,
  ]
  if (failure?.exitCode !== undefined) {
    lines.push(`退出码：${failure.exitCode}`)
  }
  if (failure?.timedOut) {
    lines.push('该步骤没有输出后被杀掉：等满超时时间仍未结束，已强制终止进程')
  }
  if (failure && failure.outputTail && failure.outputTail.length > 0) {
    lines.push(`该步骤输出末尾 ${failure.outputTail.length} 行：`)
    for (const line of failure.outputTail) {
      lines.push(`    ${line}`)
    }
  }
  if (result.outputDir !== '') {
    lines.push(`输出目录：${result.outputDir}`)
  }
  if (result.workDir !== '') {
    lines.push(`工作目录：${result.workDir}`)
  }
  lines.push(`日志：${result.logFile}`)
  if (result.warnings.length > 0) {
    lines.push('过程中的提醒：')
    for (const warning of result.warnings) {
      lines.push(`    ${warning}`)
    }
  }
  // 记事本也能正常换行，别只给 \n
  return lines.join('\r\n')
}

export function PackScreen() {
  const { jksItems, getChannels } = useAppStore()
  const [apkPath, setApkPath] = useState('')
  const [dragging, setDragging] = useState(false)
  const [jksId, setJksId] = useState('')
  const [channels, setChannels] = useState<ChannelEntry[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [outputDir, setOutputDir] = useState('')
  const [signMode, setSignMode] = useState<SignMode>('sign')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** 「查看渠道」的结果，非 null 时弹窗展示 */
  const [showResult, setShowResult] = useState<WalleShowResult | null>(null)
  const [showTarget, setShowTarget] = useState('')
  const [showing, setShowing] = useState(false)

  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [result, setResult] = useState<TaskResult | null>(null)
  /** 「复制诊断信息」点过了，用来把按钮旁的提示换掉 */
  const [copied, setCopied] = useState(false)
  /** 本次出包用的参数，供结果卡片上的「重跑本次」填回表单 */
  const [lastRun, setLastRun] = useState<TaskInput | null>(null)
  // null 表示「本界面还没启动过任务」；此时到达的进度一定属于本次启动
  const taskIdRef = useRef<string | null>(null)
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
        setCopied(false)
        setRunning(false)
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (jksItems.length === 0) {
      setJksId('')
      return
    }
    if (!jksItems.some((item) => item.id === jksId)) {
      setJksId(jksItems[0].id)
    }
  }, [jksItems, jksId])

  useEffect(() => {
    if (!jksId) {
      setChannels([])
      setPicked(new Set())
      return
    }
    let cancelled = false
    getChannels(jksId)
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
        // 「重跑本次」恢复的勾选：只留这个 jks 里还存在的渠道，
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
  }, [jksId, getChannels])

  const selectedJks = jksItems.find((item) => item.id === jksId)

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
   * 渠道号与额外信息都要完整显示，塞进一行很容易被截断，也分不清哪段是哪段。
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

  const handleStart = async () => {
    setLines([])
    setResult(null)
    setCopied(false)
    setStatus(null)
    setStage('启动中')
    taskIdRef.current = null
    setRunning(true)
    // 先记下这次用的参数，跑完能在结果卡片上「重跑本次」
    const params: TaskInput = {
      apkPath: apkPath.trim(),
      jksId,
      channelCodes: [...picked],
      signMode,
      outputDir: outputDir.trim(),
    }
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

  const handleCopyDiagnostic = async (): Promise<void> => {
    if (!result) {
      return
    }
    try {
      await window.api.writeClipboard(buildDiagnostic(result))
      setCopied(true)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 「重跑本次」只把参数填回表单，不立刻开跑：同一份包换个渠道、换个输出目录再跑
   * 是常见动作，直接开跑会让人来不及改。
   *
   * 勾选要分两条路走 —— 换了 jks 的话，下面读渠道列表那个 effect 会重跑并把勾选
   * 重置成全选，所以得把要恢复的勾选交给它；没换 jks 时它不会跑，直接套用。
   */
  const handleRerun = () => {
    if (!lastRun) {
      return
    }
    if (lastRun.jksId === jksId) {
      const available = new Set(channels.map((entry) => entry.channel))
      setPicked(new Set(lastRun.channelCodes.filter((code) => available.has(code))))
    } else {
      pendingPickedRef.current = lastRun.channelCodes
    }
    setApkPath(lastRun.apkPath)
    setJksId(lastRun.jksId)
    setSignMode(lastRun.signMode)
    setOutputDir(lastRun.outputDir)
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
    if (!selectedJks) {
      list.push('尚未选择 jks')
    }
    if (channels.length === 0) {
      list.push('该 jks 还没有渠道条目')
    } else if (picked.size === 0) {
      list.push('尚未勾选任何渠道')
    }
    if (!outputDir.trim()) {
      list.push('尚未设置输出目录')
    }
    return list
  }, [apkPath, selectedJks, channels.length, picked.size, outputDir])

  const canStart = blockers.length === 0 && !running

  // 失败诊断只在失败时存在；提到这里是为了在 JSX 里拿到窄化后的类型
  const failure = result && !result.ok ? result.failure : undefined

  // 输出目录是出包一开始就建的（工作目录在它下面），校验阶段就失败时它才是空的
  const openDirTarget = result ? result.outputDir : ''

  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="一个 APK 配一个 jks，勾选渠道后生成渠道包。产物名为 <原包名>_<别名>.apk。" />

      <Card>
        <CardHeader>
          <CardTitle>输入 APK</CardTitle>
          <CardDescription>拖进来，或点右侧按钮选择</CardDescription>
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
            <p className="text-sm">把 APK 拖到这里</p>
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
                title="用 walle show 读这个包的渠道号"
              >
                <Eye />
                查看渠道
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>签名与渠道</CardTitle>
          <CardDescription>
            {selectedJks
              ? `别名 ${selectedJks.alias} ｜ 应用名 ${selectedJks.app}`
              : '请选择一个 jks'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pack-jks">jks</Label>
              <Select value={jksId} onValueChange={setJksId}>
                <SelectTrigger id="pack-jks">
                  <SelectValue placeholder="请选择 jks" />
                </SelectTrigger>
                <SelectContent>
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
              <Select value={signMode} onValueChange={(value) => setSignMode(value as SignMode)}>
                <SelectTrigger id="pack-sign-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sign">重签名（zipalign + apksigner）</SelectItem>
                  <SelectItem value="skip">跳过签名（用已签好的包，会先核对证书）</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
              <p className="text-sm text-muted-foreground">
                该 jks 还没有渠道条目，请先到「渠道配置」添加。
              </p>
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
            status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      ) : null}

      <ProgressPanel stage={stage} lines={lines} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleStart} disabled={!canStart}>
          {running ? '出包中…' : '开始出包'}
        </Button>
        {blockers.length > 0 ? (
          <span className="text-sm text-muted-foreground">还差：{blockers.join('、')}</span>
        ) : null}
      </div>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.ok ? '出包完成' : '出包失败'}
              {result.ok ? <Badge variant="outline">{result.artifacts.length} 个包</Badge> : null}
            </CardTitle>
            <CardDescription>
              {result.message}
              {result.outputDir ? ` ｜ 输出目录：${result.outputDir}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleOpenPath(openDirTarget, '输出目录')}
              >
                <FolderOpen />
                打开输出目录
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRerun}
                disabled={lastRun === null || running}
              >
                <RotateCcw />
                重跑本次
              </Button>
              <span className="text-xs text-muted-foreground">
                「重跑本次」只把参数填回上面的表单，不会立刻开跑
              </span>
            </div>

            {result.artifacts.length > 0 ? (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>文件名</TableHead>
                      <TableHead>渠道号</TableHead>
                      <TableHead>别名</TableHead>
                      <TableHead>校验</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.artifacts.map((artifact) => (
                      <TableRow key={artifact.fileName}>
                        <TableCell className="max-w-[20rem] truncate" title={artifact.path}>
                          {artifact.fileName}
                        </TableCell>
                        <TableCell>{artifact.channel || '(空)'}</TableCell>
                        <TableCell>{artifact.alias ?? '—'}</TableCell>
                        <TableCell>
                          {artifact.verified ? (
                            <Badge variant="outline">通过</Badge>
                          ) : (
                            <Badge variant="destructive">{artifact.note ?? '未通过'}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            {failure ? (
              <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                  <span>
                    卡在：<span className="font-medium">{STAGE_LABELS[failure.stage]}</span>
                  </span>
                  {failure.exitCode !== undefined ? (
                    <span>
                      退出码：<span className="font-mono">{failure.exitCode}</span>
                    </span>
                  ) : null}
                  {failure.timedOut ? <span>卡住后已强制结束</span> : null}
                  <span className="text-muted-foreground">任务号 {result.taskId}</span>
                </div>

                {failure.outputTail && failure.outputTail.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      这个步骤的输出末尾 {failure.outputTail.length} 行：
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                      {failure.outputTail.join('\n')}
                    </pre>
                  </>
                ) : failure.timedOut ? (
                  <p className="text-sm text-muted-foreground">
                    这个进程从头到尾一个字都没输出，等到超时就被强制结束了 —— 日志里能看到它停在哪个动作上。
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    这一步没有子进程输出 —— 报错来自程序自己的检查，不用去日志里找。
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopyDiagnostic}>
                    <Copy />
                    复制诊断信息
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {copied
                      ? '已复制，路径里的家目录已换成 %USERPROFILE%'
                      : '复制的内容里，路径的家目录会换成 %USERPROFILE%'}
                  </span>
                </div>

                {result.workDir !== '' ? (
                  <p className="text-xs text-muted-foreground">
                    工作目录（失败时保留，可对着中间产物排查）：{result.workDir}
                  </p>
                ) : null}
              </div>
            ) : null}

            {/*
              这里不用 Button：日志路径要能折行（`whitespace-nowrap` 写在 Button 的基类里，
              再叠一个 whitespace-normal 谁赢取决于 Tailwind 的生成顺序，不保险）。
            */}
            <div className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground">
              <span>日志：</span>
              <button
                type="button"
                onClick={() => void handleOpenPath(result.logFile, '日志')}
                title="用系统默认程序打开这份日志"
                className="inline-flex items-baseline gap-1 break-all text-left font-mono text-primary underline-offset-4 hover:underline"
              >
                <FileText className="size-3.5 shrink-0 self-center" />
                {result.logFile}
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
              {showTarget ? `读取 ${baseNameOf(showTarget)} 的渠道信息` : '读取包的渠道信息'}
            </DialogDescription>
          </DialogHeader>

          {showing ? (
            <p className="text-sm text-muted-foreground">读取中…</p>
          ) : showResult === null ? null : !showResult.ok ? (
            <p className="text-sm text-destructive">
              没能读出渠道信息：{showResult.message}
            </p>
          ) : (showResult.channel ?? '') === '' && !showResult.extraInfo ? (
            <p className="text-sm text-muted-foreground">
              这个包里没有渠道信息，说明它还没被写过渠道。
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">渠道号</span>
                <span className="break-all font-mono">
                  {showResult.channel && showResult.channel !== '' ? showResult.channel : '(空)'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground">额外信息</span>
                <span className="break-all font-mono">
                  {showResult.extraInfo ? showResult.extraInfo : '(无)'}
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
