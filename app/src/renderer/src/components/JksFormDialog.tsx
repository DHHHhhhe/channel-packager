import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Eye, EyeOff, FileUp, KeyRound, Wand2 } from 'lucide-react'
import { ChannelListPreviewDialog } from '@/components/ChannelListPreviewDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
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
import type { ChannelListPreview } from '@shared/types/pack'
import type { ChannelConfig, JksItem } from '@shared/types/store'
import { buildChannelsFromTemplate } from '@shared/utils/channels'
import { deriveAlias, derivePassword } from '@shared/utils/credentials'
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

type ChannelMode = 'empty' | 'template' | 'json'

/** 与文件选择框的 accept 保持一致：拖进来的文件不走 accept，得自己判 */
const JKS_EXTENSIONS = ['.jks', '.keystore']

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
  /** 最终要保存的渠道列表。三种来源都只是「怎么填这份列表」，列表本身才是真相 */
  const [draftChannels, setDraftChannels] = useState<PairRow[]>([])
  /** 导入 JSON 的待确认内容；null 表示没有待确认的导入 */
  const [jsonPreview, setJsonPreview] = useState<ChannelListPreview | null>(null)
  /** 用户是否在下面的列表里手改过（用来判断重新生成前要不要问一声） */
  const [handEdited, setHandEdited] = useState(false)
  /** 「按模板重新生成」的确认框 */
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正有文件被拖在对话框上方，用来高亮投放区 */
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  /*
   * dragenter/dragleave 会在子元素之间来回触发，
   * 用深度计数判断「真正离开了对话框」，否则高亮会一闪一闪。
   */
  const dragDepth = useRef(0)

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
    setDraftChannels([])
    setJsonPreview(null)
    setHandEdited(false)
    setConfirmRegenerate(false)
    setShowPassword(false)
    setFeedback(null)
    setBusy(false)
    setDragging(false)
    dragDepth.current = 0
  }, [open, item])

  const isEdit = Boolean(item)

  /*
   * 新增模式下还没选 jks 文件时，渠道数据整块不可操作。
   * 渠道列表是挂在 jks 上的（data/channels/<id>.json），id 又由文件名推导而来，
   * 文件都没选就先让人编渠道，编完也无处可落，只能白填。
   */
  const noJks = !isEdit && sourcePath.trim() === ''

  /** 按模板 + 前缀算出一份新的草稿行 */
  const templateDraft = (value: string): PairRow[] =>
    buildChannelsFromTemplate(template.suffixes, value, app.trim()).channelInfoList.map((entry) =>
      newPairRow(entry.channel, entry.alias ?? ''),
    )

  /*
   * 程序性写入草稿（生成、导入、换来源）都走这里，顺便把「手改过」标记清掉。
   * 下面列表里的编辑不走这里 —— 那个标记就是用来区分「这份列表还是生成的原样」和「用户动过」。
   */
  const applyDraft = (next: PairRow[]) => {
    setDraftChannels(next)
    setHandEdited(false)
  }

  /** 按当前前缀重新生成一份草稿 */
  const regenerateFromTemplate = () => {
    const next = templateDraft(prefix)
    applyDraft(next)
    setFeedback({
      kind: 'ok',
      text: `已按前缀「${prefix.trim() || '（空）'}」生成 ${next.length} 条。`,
    })
  }

  /*
   * 重新生成会整表替换。列表还是生成的原样就直接换；
   * 用户手改过就先问一声 —— 那些改动没有别的地方存着，换掉就没了。
   */
  const handleRegenerateClick = () => {
    if (handEdited && draftChannels.length > 0) {
      setConfirmRegenerate(true)
      return
    }
    regenerateFromTemplate()
  }

  const handlePickSource = (file: File | undefined) => {
    if (!file) {
      return
    }
    // 拖进来的文件不受 accept 过滤，这里自己挡一道，免得后面 keytool 报一句难懂的话
    const lower = file.name.toLowerCase()
    if (!JKS_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setFeedback({
        kind: 'error',
        text: lower.endsWith('.json')
          ? '这是 JSON 渠道文件，不是 jks；请用下面「渠道数据」里的「选择文件」。'
          : `只认 .jks / .keystore 文件，这个是「${file.name}」。`,
      })
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

  /*
   * 把 .jks 拖进对话框。
   * 只在新增模式生效 —— 编辑模式没有「选文件」这一步，接受拖入反而会让人以为换了文件。
   */
  const acceptsDrop = (event: DragEvent<HTMLDivElement>): boolean =>
    !isEdit && event.dataTransfer.types.includes('Files')

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) {
      return
    }
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) {
      return
    }
    // 不 preventDefault 的话浏览器认为这里不接受拖放，drop 事件根本不会来
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) {
      return
    }
    event.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsDrop(event)) {
      return
    }
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    handlePickSource(event.dataTransfer.files[0])
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
      /*
       * K3：原样导入，不做任何前缀替换。
       * 这里先不填列表，只给一份可编辑的预览 —— 选错文件时不会把已经编好的渠道冲掉。
       */
      const notes: string[] = []
      const fileApp = parsed.defaultExtraInfo?.app?.trim()
      if (fileApp && fileApp !== app.trim()) {
        notes.push(
          `文件里的 defaultExtraInfo.app 是「${fileApp}」，保存时按表单里的「${app.trim() || '空'}」写。`,
        )
      }
      setJsonPreview({
        fileName: file.name,
        channels: parsed.channelInfoList.map((entry) => ({
          channel: entry.channel,
          alias: entry.alias,
        })),
        count: parsed.channelInfoList.length,
        notes,
      })
      setChannelMode('json')
      setFeedback(null)
    } catch (error) {
      setFeedback({
        kind: 'error',
        text: `这份 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /** 预览框里点确认：这时才把改过的条目填进草稿列表 */
  const handleConfirmJson = (imported: PairRow[]) => {
    applyDraft(imported)
    setJsonPreview(null)
    setFeedback({ kind: 'ok', text: `已导入 ${imported.length} 条渠道，可在下方直接改。` })
  }

  /**
   * 切换来源只是「用什么填这份列表」。
   * 换到模板就按当前前缀生成一份；换到不套用模板就清空，让用户手工加行；
   * 换到 JSON 先清空，等选文件 —— 否则会显示上一次的来源留下的内容，容易误以为已经读到文件。
   */
  const handleModeChange = (value: string) => {
    const next = value as ChannelMode
    setChannelMode(next)
    setFeedback(null)
    if (next === 'template') {
      applyDraft(templateDraft(prefix))
    } else {
      applyDraft([])
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

    /*
     * 草稿列表才是最终内容，不再按来源分支 ——
     * 用户可能选「不套用模板」后手工加了几行，那几行同样要落库。
     * 一条都没有时不写渠道文件，与之前的行为一致（读的时候给空配置）。
     */
    const channelInfoList = draftChannels
      .map((row) => ({ channel: row.key.trim(), alias: row.alias.trim() }))
      .filter((row) => row.channel !== '')
      .map((row) => (row.alias !== '' ? row : { channel: row.channel }))
    if (channelInfoList.length > 0) {
      await saveChannels(created.id, {
        defaultExtraInfo: { app: created.app },
        channelInfoList,
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
    if (draftChannels.some((row) => row.key.trim() === '')) {
      setFeedback({ kind: 'error', text: '渠道名不能为空，请补全或删掉空行。' })
      return
    }
    const duplicated = findDuplicates(draftChannels.map((row) => row.key))
    if (duplicated.length > 0) {
      setFeedback({ kind: 'error', text: `渠道名重复：${duplicated.join('、')}` })
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑 ${item?.displayName}` : '新增 jks'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改后会按 data/keystores/ 下的副本做一次校验，通过才保存。'
              : '选择 jks 文件后会自动带出别名与口令，可手工改。保存前会用内置 keytool 校验一次。'}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex flex-col gap-4"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {!isEdit ? (
            <div
              className={
                dragging
                  ? 'flex flex-col gap-1.5 rounded-lg border border-dashed border-primary bg-primary/5 p-3'
                  : 'flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3'
              }
            >
              <Label htmlFor="jks-source">jks 文件</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="jks-source"
                  value={sourcePath}
                  onChange={(event) => setSourcePath(event.target.value)}
                  placeholder="把 .jks 拖到这里，或点右侧按钮选择"
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
                也可以把文件直接拖到本对话框的任意位置。
              </p>
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
              <div className="relative">
                <Input
                  id="jks-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="sample@123"
                  className="pr-11"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏口令' : '查看口令明文'}
                  title={showPassword ? '隐藏口令' : '查看口令明文'}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
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
                <span className="text-xs text-muted-foreground">
                  {noJks
                    ? '先在上面选择 jks 文件'
                    : `共 ${draftChannels.length} 条，下面就是最终保存的内容，可直接改`}
                </span>
              </div>
              <Select value={channelMode} onValueChange={handleModeChange} disabled={noJks}>
                <SelectTrigger aria-label="渠道数据来源">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empty">不套用模板，得到空列表</SelectItem>
                  <SelectItem value="template">套用模板</SelectItem>
                  <SelectItem value="json">导入 JSON（先预览，可改）</SelectItem>
                </SelectContent>
              </Select>

              {channelMode === 'template' ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="jks-prefix">渠道前缀</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="jks-prefix"
                      value={prefix}
                      onChange={(event) => setPrefix(event.target.value)}
                      placeholder="默认等于 jks 文件名"
                      className="w-64"
                      disabled={noJks}
                    />
                    <Button
                      variant="outline"
                      type="button"
                      onClick={handleRegenerateClick}
                      disabled={noJks}
                    >
                      <Wand2 />
                      按模板重新生成
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    渠道名 = 前缀 + &quot;_&quot; + 后缀。改前缀不会动下面的列表，
                    点「按模板重新生成」才按新前缀重算。
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
                      disabled={noJks}
                    >
                      <FileUp />
                      选择 JSON
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {draftChannels.length > 0 ? `已导入 ${draftChannels.length} 条` : '尚未导入'}
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

              <PairListEditor
                rows={draftChannels}
                onChange={(next) => {
                  // 列表里的编辑不走 applyDraft：这个标记就是用来记住「用户动过」
                  setDraftChannels(next)
                  setHandEdited(true)
                }}
                keyLabel="渠道名"
                keyPlaceholder="例如 sample_gf"
                aliasPlaceholder="例如 官方"
                selectable
                disabled={noJks}
                emptyHint={
                  noJks
                    ? '选择 jks 文件后，这里就能编辑渠道了。'
                    : channelMode === 'empty'
                      ? '还没有渠道条目。点下面的「添加一行」就能直接给这个 jks 加渠道。'
                      : channelMode === 'template'
                        ? '模板为空，生成不出条目。可改用「不套用模板」手工添加。'
                        : '还没读到渠道。选一份 channelConfig.json 就会出现在这里。'
                }
              />
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

      {/*
        导入 JSON 的预览框。放在外层 Dialog 的根里而不是外面 —— 它自己会 portal 到 body，
        嵌套只是为了让 Radix 的层级栈把它排在新增 jks 之上；不用 Fragment 是为了避免整段重排缩进。
      */}
      <ChannelListPreviewDialog
        open={jsonPreview !== null}
        onOpenChange={(next) => (next ? undefined : setJsonPreview(null))}
        title="导入渠道 JSON"
        preview={jsonPreview}
        onConfirm={handleConfirmJson}
      />

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="按模板重新生成？"
        description="会按当前前缀重算整份列表，然后覆盖下面这些行。"
        warning={`你在下面改过 ${draftChannels.length} 条，重新生成后这些改动就没了。`}
        confirmText="重新生成"
        onConfirm={() => {
          setConfirmRegenerate(false)
          regenerateFromTemplate()
        }}
      />
    </Dialog>
  )
}
