import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Package, Upload } from 'lucide-react'
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
import type { SignMode, TaskResult, TaskStage, WalleShowResult } from '@shared/types/task'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

const STAGE_LABELS: Record<TaskStage, string> = {
  validate: '校验输入',
  prepare: '准备工作目录',
  align: 'zipalign 对齐',
  sign: 'apksigner 重签名',
  'verify-sign': '校验签名',
  rename: '还原为原包名',
  'resigned-copy': '另存 _resigned',
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
  // null 表示「本界面还没启动过任务」；此时到达的进度一定属于本次启动
  const taskIdRef = useRef<string | null>(null)

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
        setPicked(new Set(config.channelInfoList.map((entry) => entry.channel)))
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
    setStatus(null)
    setStage('启动中')
    taskIdRef.current = null
    setRunning(true)
    try {
      const started = await window.api.runTask({
        apkPath: apkPath.trim(),
        jksId,
        channelCodes: [...picked],
        signMode,
        outputDir: outputDir.trim(),
      })
      taskIdRef.current = started.taskId
    } catch (error) {
      setRunning(false)
      setStage('失败')
      setLines([ipcErrorMessage(error)])
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
                  <SelectItem value="skip">跳过签名（直接用原包）</SelectItem>
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

            <p className="text-xs text-muted-foreground">日志：{result.logFile}</p>
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
