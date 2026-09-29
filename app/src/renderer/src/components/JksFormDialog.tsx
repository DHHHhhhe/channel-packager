import { useEffect, useRef, useState } from 'react'
import { FileUp, KeyRound } from 'lucide-react'
import { PlaintextPasswordNotice } from '@/components/PlaintextPasswordNotice'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChannelEntry, ChannelConfig, JksItem } from '@shared/types/store'
import { buildChannelsFromTemplate } from '@shared/utils/channels'
import { deriveAlias, derivePassword } from '@shared/utils/credentials'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

type ChannelMode = 'empty' | 'template' | 'json'

interface JksFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传入即为编辑模式；不传是新增 */
  item?: JksItem
  onFinished: (message: string) => void
}

function fileNameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function JksFormDialog({ open, onOpenChange, item, onFinished }: JksFormDialogProps) {
  const { template, jksItems, saveJks, saveChannels, verifyCredentials } = useAppStore()

  const [sourcePath, setSourcePath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [alias, setAlias] = useState('')
  const [password, setPassword] = useState('')
  const [app, setApp] = useState('')
  const [channelMode, setChannelMode] = useState<ChannelMode>('empty')
  const [prefix, setPrefix] = useState('')
  const [importedChannels, setImportedChannels] = useState<ChannelEntry[] | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  // 每次打开都从当前条目重置，避免上一次的残留
  useEffect(() => {
    if (!open) {
      return
    }
    setSourcePath(item?.sourcePath ?? '')
    setDisplayName(item?.displayName ?? '')
    setAlias(item?.alias ?? '')
    setPassword(item?.storePassword ?? '')
    setApp(item?.app ?? '')
    setChannelMode('empty')
    setPrefix(item?.id ?? '')
    setImportedChannels(null)
    setFeedback(null)
    setBusy(false)
  }, [open, item])

  const isEdit = Boolean(item)

  const handlePickSource = (file: File | undefined) => {
    if (!file) {
      return
    }
    const picked = window.api.pathForFile(file)
    if (!picked) {
      setFeedback({ kind: 'error', text: '没能取到文件路径，请重新选择。' })
      return
    }
    const base = deriveAlias(picked)
    setSourcePath(picked)
    setDisplayName(fileNameOf(picked))
    setAlias(base)
    setPassword(derivePassword(picked))
    setApp(base)
    setPrefix(base)
    setFeedback(null)
  }

  const handlePickJson = async (file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ChannelConfig>
      if (!Array.isArray(parsed.channelInfoList)) {
        setFeedback({ kind: 'error', text: '这份 JSON 里没有 channelInfoList 数组。' })
        return
      }
      const invalid = parsed.channelInfoList.some(
        (entry) => typeof entry?.channel !== 'string' || entry.channel.trim() === '',
      )
      if (invalid) {
        setFeedback({ kind: 'error', text: 'channelInfoList 里有条目缺少 channel 字段。' })
        return
      }
      // K3：原样导入，不做任何前缀替换
      setImportedChannels(parsed.channelInfoList)
      setChannelMode('json')
      setFeedback({ kind: 'ok', text: `已读取 ${parsed.channelInfoList.length} 条渠道。` })
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: `这份 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const handleEditSave = async (target: JksItem) => {
    // 编辑走副本校验，通过了才落库
    const result = await verifyCredentials(target.id, password, alias)
    if (!result.ok) {
      setFeedback({ kind: 'error', text: `凭据校验未通过：${result.message ?? '原因未知'}` })
      return false
    }
    const finalAlias = result.alias ?? alias.trim()
    await saveJks({
      action: 'update',
      item: {
        ...target,
        displayName: displayName.trim() || target.displayName,
        alias: finalAlias,
        storePassword: password,
        app: app.trim() || target.app,
        credentialSource: 'manual',
      },
    })
    if (finalAlias !== alias.trim()) {
      setFeedback({ kind: 'ok', text: `别名已按 keystore 实际内容修正为「${finalAlias}」。` })
    }
    return true
  }

  const handleCreate = async () => {
    const added = await saveJks({
      action: 'add',
      sourcePath,
      displayName: displayName.trim() || undefined,
      alias: alias.trim(),
      storePassword: password,
      app: app.trim() || undefined,
    })
    if (added.status === 'duplicate') {
      setFeedback({ kind: 'error', text: added.message ?? '该文件已存在。' })
      return false
    }
    const created = added.item
    if (!created) {
      setFeedback({ kind: 'error', text: '新增后没有拿到条目信息。' })
      return false
    }

    /*
     * R21 要求校验只读副本，而副本是上一步才建出来的。
     * 所以这里先建、再校验，校验不通过就把条目与副本一起删掉 ——
     * 净效果等同于「没保存」，既没有绕过副本约束，也不会留下半条脏数据。
     */
    const result = await verifyCredentials(created.id, password, alias)
    if (!result.ok) {
      await saveJks({ action: 'remove', id: created.id })
      setFeedback({
        kind: 'error',
        text: `凭据校验未通过，已撤销本次新增：${result.message ?? '原因未知'}`,
      })
      return false
    }

    const finalAlias = result.alias ?? alias.trim()
    if (finalAlias !== alias.trim()) {
      await saveJks({ action: 'update', item: { ...created, alias: finalAlias } })
    }

    if (channelMode === 'template') {
      await saveChannels(
        created.id,
        buildChannelsFromTemplate(template.suffixes, prefix, created.app),
      )
    } else if (channelMode === 'json' && importedChannels) {
      await saveChannels(created.id, {
        defaultExtraInfo: { app: created.app },
        channelInfoList: importedChannels,
      })
    }

    const suffix =
      finalAlias !== alias.trim() ? `，别名已修正为「${finalAlias}」` : ''
    onFinished(`已新增 ${created.id} 并校验通过${suffix}。`)
    return true
  }

  const handleSubmit = async () => {
    if (!isEdit && !sourcePath) {
      setFeedback({ kind: 'error', text: '请先选择 jks 文件。' })
      return
    }
    if (!alias.trim()) {
      setFeedback({ kind: 'error', text: '别名不能为空。' })
      return
    }
    if (!password) {
      setFeedback({ kind: 'error', text: '口令不能为空。' })
      return
    }
    if (isEdit && item && jksItems.length === 0) {
      setFeedback({ kind: 'error', text: 'jks 列表为空，无法保存。' })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      const saved = isEdit && item ? await handleEditSave(item) : await handleCreate()
      if (saved) {
        onOpenChange(false)
      }
    } catch (error) {
      setFeedback({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑 ${item?.displayName}` : '新增 jks'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改后会按 data/keystores/ 下的副本做一次校验，通过才保存。'
              : '选择 jks 文件后会自动带出别名与口令，可手工改。保存前会用内置 keytool 校验一次。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!isEdit ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-source">jks 文件</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="jks-source"
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  placeholder="拖入或点击右侧按钮选择 .jks 文件"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <FileUp />
                  选择
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jks,.keystore"
                className="hidden"
                onChange={(event) => {
                  handlePickSource(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
              <p className="text-xs text-muted-foreground">
                副本会复制到 data/keystores/，之后签名只用副本；原文件移走也不影响出包。
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>来源路径</Label>
              <p className="truncate text-sm text-muted-foreground" title={item?.sourcePath}>
                {item?.sourcePath}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-display-name">显示名</Label>
              <Input
                id="jks-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="sample.jks"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-alias">别名</Label>
              <Input
                id="jks-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="sample"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-password">口令</Label>
              <Input
                id="jks-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="sample@123"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-app">应用名</Label>
              <Input
                id="jks-app"
                value={app}
                onChange={(event) => setApp(event.target.value)}
                placeholder="写入 defaultExtraInfo.app"
              />
            </div>
          </div>

          <PlaintextPasswordNotice />

          {!isEdit ? (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 shrink-0" />
                <span className="text-sm font-medium">渠道数据</span>
              </div>
              <Select value={channelMode} onValueChange={(value) => setChannelMode(value as ChannelMode)}>
                <SelectTrigger aria-label="渠道数据来源">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empty">不套用模板，得到空列表</SelectItem>
                  <SelectItem value="template">套用模板</SelectItem>
                  <SelectItem value="json">导入 JSON（原样复制）</SelectItem>
                </SelectContent>
              </Select>

              {channelMode === 'template' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="jks-prefix">渠道前缀</Label>
                  <Input
                    id="jks-prefix"
                    value={prefix}
                    onChange={(event) => setPrefix(event.target.value)}
                    placeholder="默认等于 jks 文件名"
                  />
                  <p className="text-xs text-muted-foreground">
                    将生成 {template.suffixes.length} 条：渠道名 = 前缀 + &quot;_&quot; + 后缀。
                  </p>
                </div>
              ) : null}

              {channelMode === 'json' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => jsonInputRef.current?.click()}
                    >
                      <FileUp />
                      选择 JSON
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {importedChannels
                        ? `已读取 ${importedChannels.length} 条`
                        : '尚未选择文件'}
                    </span>
                  </div>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(event) => {
                      void handlePickJson(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    沿用 channelConfig.json 的结构，渠道名原样导入，不做前缀替换。
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {feedback ? (
            <p
              className={
                feedback.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
              }
            >
              {feedback.text}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? '处理中…' : isEdit ? '保存修改' : '新增并校验'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
