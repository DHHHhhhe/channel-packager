import { useEffect, useMemo, useState } from 'react'
import { Package, Upload } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { ProgressPanel } from '@/components/ProgressPanel'
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
import type { ChannelEntry } from '@shared/types/store'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

type SignMode = 'sign' | 'skip'

/** 默认输出到 APK 同级的「渠道包」目录（K11） */
function defaultOutputDir(apkPath: string): string {
  if (!apkPath) {
    return ''
  }
  const normalized = apkPath.replace(/\//g, '\\')
  const cut = normalized.lastIndexOf('\\')
  return cut < 0 ? '渠道包' : `${normalized.slice(0, cut)}\\渠道包`
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

  const allPicked = channels.length > 0 && picked.size === channels.length
  const blockers = useMemo(() => {
    const list: string[] = []
    if (!apkPath) {
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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="出包"
        description="一个 APK 配一个 jks，勾选渠道后生成渠道包。产物名为 <原包名>_<别名>.apk。"
      />

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
            <Input
              id="apk-path"
              value={apkPath}
              onChange={(event) => {
                setApkPath(event.target.value)
                setOutputDir(defaultOutputDir(event.target.value))
              }}
              placeholder="拖入或选择后自动填入"
            />
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
                  setPicked(
                    allPicked ? new Set() : new Set(channels.map((entry) => entry.channel)),
                  )
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
                {channels.map((entry) => (
                  <label
                    key={entry.channel}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <Checkbox
                      checked={picked.has(entry.channel)}
                      onCheckedChange={(value) => toggleChannel(entry.channel, value === true)}
                      aria-label={entry.channel}
                    />
                    <span className="truncate" title={entry.channel}>
                      {entry.alias ?? entry.channel}
                    </span>
                  </label>
                ))}
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

      <ProgressPanel stage={null} lines={[]} />

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled title="出包流水线在阶段 5 接入">
          开始出包
        </Button>
        {blockers.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            还差：{blockers.join('、')}
          </span>
        ) : null}
      </div>
    </div>
  )
}
