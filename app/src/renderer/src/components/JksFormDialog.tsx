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
import { Spinner } from '@/components/ui/spinner'
import type { ChannelListPreview } from '@shared/types/pack'
import type { ChannelConfig, CredentialField, JksItem } from '@shared/types/store'
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
  const { template, jksItems, saveJks, saveChannels, saveGroup, verifyCredentials } = useAppStore()

  const [sourcePath, setSourcePath] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [alias, setAlias] = useState('')
  const [password, setPassword] = useState('')
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
  /** 待确认的「换渠道来源」；null 表示没有待确认的切换。确认前 channelMode 不动 */
  const [pendingMode, setPendingMode] = useState<ChannelMode | null>(null)
  /** 主进程回传的候选别名：别名猜错时用户点一下就能填上，不用从提示里抄 */
  const [aliasCandidates, setAliasCandidates] = useState<string[]>([])
  /** 递增一下就让渠道草稿列表把搜索清掉 —— 保存被拦下时，问题行可能正被搜索藏着 */
  const [filterResetToken, setFilterResetToken] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** 被判定有问题的字段，界面上标红。用户一改动该项就清掉 */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CredentialField, boolean>>>({})
  const [busy, setBusy] = useState(false)
  /** 正有文件被拖在对话框上方，用来高亮投放区 */
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  /** 提示块自己。它现在在标题下方，从底部点保存时要能把它滚回视口里 */
  const feedbackRef = useRef<HTMLParagraphElement>(null)
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
    setChannelMode('empty')
    setPrefix(item?.id ?? '')
    setDraftChannels([])
    setJsonPreview(null)
    setHandEdited(false)
    setConfirmRegenerate(false)
    setPendingMode(null)
    setAliasCandidates([])
    setShowPassword(false)
    setFeedback(null)
    setFieldErrors({})
    setBusy(false)
    setDragging(false)
    dragDepth.current = 0
  }, [open, item])

  /*
   * 提示块在标题下方，而用户往往是在滚动区最底部（渠道列表那一片）点的保存 ——
   * 不把它滚回视口里，点了按钮界面上就等于没反应，最自然的下一步是反复点。
   * block:'nearest' 在它本来就在视口里时不滚动，免得每次提示都跳一下。
   */
  useEffect(() => {
    if (feedback) {
      feedbackRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [feedback])

  const isEdit = Boolean(item)

  /*
   * 新增模式下还没选 jks 文件时，渠道数据整块不可操作。
   * 保存时会顺手建一个同 id 的分组来存这份渠道（见 handleCreate），而 id 由文件名推导，
   * 文件都没选就先让人编渠道，编完也无处可落，只能白填。
   */
  const noJks = !isEdit && sourcePath.trim() === ''

  /*
   * 校验失败时把出问题的那一项标红，但**不重置任何字段** ——
   * 用户填了半天的东西不该因为一次口令打错就清空。
   * 主进程会告诉我们该查哪一项（`CredentialVerifyResult.field`），
   * 界面不靠匹配提示文案来猜。
   *
   * aliases 是主进程算好的候选别名，直接摆在别名框下面给用户点。
   */
  const failWith = (text: string, field?: CredentialField, aliases?: string[]): void => {
    setFeedback({ kind: 'error', text })
    setFieldErrors(field ? { [field]: true } : {})
    setAliasCandidates(aliases ?? [])
  }

  /** 成功提示：顺手把红框全清掉 */
  const succeedWith = (text: string): void => {
    setFeedback({ kind: 'ok', text })
    setFieldErrors({})
  }

  /** 用户一改动某项就撤掉它的红框，免得改完了还红着 */
  const clearFieldError = (field: CredentialField): void => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current
      }
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  /** 按模板 + 前缀算出一份新的草稿行 */
  const templateDraft = (value: string): PairRow[] =>
    buildChannelsFromTemplate(template.suffixes, value).channelInfoList.map((entry) =>
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
      // 失败也要把上一次的红框撤掉：留着它，用户会以为文件已经收下了、只是格式提示
      setFieldErrors({})
      setFeedback({
        kind: 'error',
        text: lower.endsWith('.json')
          ? '这是渠道 JSON 文件，不是签名文件；请用下方「渠道数据 → 导入 JSON」里的「选择 JSON」。'
          : `只认 .jks / .keystore 格式的签名文件，这个是「${file.name}」。`,
      })
      return
    }
    const picked = window.api.pathForFile(file)
    if (!picked) {
      setFieldErrors({})
      setFeedback({ kind: 'error', text: '没能取到文件路径，请重新选择。' })
      return
    }

    /*
     * 编辑模式只把路径指对，不动显示名、别名与密码 ——
     * 原文件被挪到别的目录、或当初就选错了路径时，用户要改的只有这一项。
     * 副本这时并没有变，提示里必须说清楚，否则会让人以为签名已经跟着换了。
     */
    if (isEdit) {
      setSourcePath(picked)
      setFieldErrors({})
      setFeedback({
        kind: 'ok',
        text: '原文件路径已更新。本工具内的副本没有变 —— 需要比对就点列表里的「从原文件重新导入」，确认要覆盖再选「刷新副本」。',
      })
      return
    }

    const base = deriveAlias(picked)
    setSourcePath(picked)
    setDisplayName(fileNameOf(picked))
    setAlias(base)
    setPassword(derivePassword(picked))
    setPrefix(base)
    setFeedback(null)
    // 换了文件，之前那个「先选择 jks 文件」的红框自然该撤掉
    clearFieldError('keystore')
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
        setFeedback({ kind: 'error', text: '这份 JSON 里没有渠道列表。' })
        return
      }
      const invalid = parsed.channelInfoList.some(
        (entry) => typeof entry?.channel !== 'string' || entry.channel.trim() === '',
      )
      if (invalid) {
        setFeedback({ kind: 'error', text: '渠道列表里有条目缺少渠道号。' })
        return
      }
      /*
       * K3：原样导入，不做任何前缀替换。
       * 这里先不填列表，只给一份可编辑的预览 —— 选错文件时不会把已经编好的渠道冲掉。
       */
      setJsonPreview({
        fileName: file.name,
        channels: parsed.channelInfoList.map((entry) => ({
          channel: entry.channel,
          alias: entry.alias,
        })),
        count: parsed.channelInfoList.length,
        notes: [],
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
    succeedWith(`已导入 ${imported.length} 条渠道，可在下方直接改。`)
  }

  /** 真正换来源：按新来源重算整份草稿 */
  const applyMode = (next: ChannelMode) => {
    setChannelMode(next)
    setFeedback(null)
    if (next === 'template') {
      applyDraft(templateDraft(prefix))
    } else {
      applyDraft([])
    }
  }

  /**
   * 切换来源只是「用什么填这份列表」。
   * 换到模板就按当前前缀生成一份；换到不套用模板就清空，让用户手工加行；
   * 换到 JSON 先清空，等选文件 —— 否则会显示上一次的来源留下的内容，容易误以为已经读到文件。
   *
   * 但这三条路都会**整份替换**下面的列表，和「按模板重新生成」是同一类动作，
   * 而那条路会先问一声。同一种后果两种待遇，用户没法预期哪次会被清掉，所以这里也问。
   * 待确认期间不改 channelMode，下拉框停在原值上，等于「取消」。
   */
  const handleModeChange = (value: string) => {
    const next = value as ChannelMode
    if (next === channelMode) {
      return
    }
    if (draftChannels.length > 0) {
      setPendingMode(next)
      return
    }
    applyMode(next)
  }

  const handleEditSave = async (target: JksItem) => {
    // 编辑走副本校验，通过了才落库
    const result = await verifyCredentials(target.id, password, alias)
    if (!result.ok) {
      failWith(`凭据校验未通过：${result.message ?? '原因未知'}`, result.field, result.aliases)
      return false
    }
    const finalAlias = result.alias ?? alias.trim()
    await saveJks({
      action: 'update',
      item: {
        ...target,
        // 来源路径在这一步才可能被改（「重新选择」），别把用户的修改漏掉
        sourcePath: sourcePath.trim() || target.sourcePath,
        displayName: displayName.trim() || target.displayName,
        alias: finalAlias,
        storePassword: password,
        credentialSource: 'manual',
      },
    })
    if (finalAlias !== alias.trim()) {
      succeedWith(`别名已按 keystore 实际内容修正为「${finalAlias}」。`)
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
    })
    if (added.status === 'duplicate') {
      failWith(added.message ?? '该文件已存在。', 'keystore')
      return false
    }
    const created = added.item
    if (!created) {
      failWith('新增后没有拿到条目信息。')
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
      failWith(
        `凭据校验未通过，已撤销本次新增：${result.message ?? '原因未知'}`,
        result.field,
        result.aliases,
      )
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
     *
     * 渠道的归属已经是「分组」（R1），所以先建一个同 id 的分组再写渠道文件 ——
     * 否则 channels/<id>.json 会变成界面上看不见的孤儿文件。
     * 分组 id 沿用 jks 的 id，文件路径与拆分前完全一致；之后删掉这个 jks 也不影响分组（R4）。
     */
    const channelInfoList = draftChannels
      .map((row) => ({ channel: row.key.trim(), alias: row.alias.trim() }))
      .filter((row) => row.channel !== '')
      .map((row) => (row.alias !== '' ? row : { channel: row.channel }))
    if (channelInfoList.length > 0) {
      const group = await saveGroup({
        action: 'add',
        id: created.id,
        name: created.displayName,
        appLabel: '',
      })
      await saveChannels(group.item?.id ?? created.id, { channelInfoList })
    }

    const suffix =
      finalAlias !== alias.trim() ? `，别名已修正为「${finalAlias}」` : ''
    const groupNote =
      channelInfoList.length > 0
        ? `，渠道已存进分组「${created.displayName}」`
        : ''
    onFinished(`已新增 ${created.id} 并校验通过${suffix}${groupNote}。`)
    return true
  }

  const handleSubmit = async () => {
    if (!isEdit && !sourcePath) {
      failWith('请先选择签名文件。', 'keystore')
      return
    }
    if (!alias.trim()) {
      failWith('别名不能为空。', 'alias')
      return
    }
    if (!password) {
      failWith('密码不能为空。', 'password')
      return
    }
    if (isEdit && item && jksItems.length === 0) {
      failWith('签名文件列表为空，无法保存。')
      return
    }
    if (draftChannels.some((row) => row.key.trim() === '')) {
      // 空行可能正被搜索藏起来，先把筛选清掉再报错，免得用户找不到
      setFilterResetToken((value) => value + 1)
      failWith('渠道名不能为空，空行已经标红。')
      return
    }
    const duplicated = findDuplicates(draftChannels.map((row) => row.key))
    if (duplicated.length > 0) {
      setFilterResetToken((value) => value + 1)
      failWith(`渠道名重复：${duplicated.join('、')}`)
      return
    }

    setBusy(true)
    setFeedback(null)
    setFieldErrors({})
    try {
      const saved = isEdit && item ? await handleEditSave(item) : await handleCreate()
      if (saved) {
        onOpenChange(false)
      }
    } catch (error) {
      failWith(ipcErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑 ${item?.displayName}` : '新增签名文件'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改后会按本工具内的副本做一次校验，通过后才保存。'
              : '选择签名文件后会自动带出别名与密码，可以手工修改。保存前会校验一次。'}
          </DialogDescription>
        </DialogHeader>

        {/*
          提示放在标题正下方，而不是滚动区末尾。
          末尾那个位置在渠道列表展开几十行时压根不在视口里 ——
          用户点完「新增并校验」，看到的只是界面没反应。
        */}
        {feedback ? (
          <p
            ref={feedbackRef}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            aria-live={feedback.kind === 'error' ? 'assertive' : 'polite'}
            className={
              feedback.kind === 'error'
                ? 'rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive'
                : feedback.kind === 'ok'
                  ? 'rounded-md border border-success/40 bg-success/5 px-3 py-2 text-sm text-success'
                  : 'text-sm text-muted-foreground'
            }
          >
            {feedback.text}
          </p>
        ) : null}

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
                  : fieldErrors.keystore
                    ? 'flex flex-col gap-1.5 rounded-lg border border-dashed border-destructive bg-destructive/5 p-3'
                    : 'flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3'
              }
            >
              <Label htmlFor="jks-source">签名文件</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="jks-source"
                  value={sourcePath}
                  aria-invalid={fieldErrors.keystore === true}
                  onChange={(event) => {
                    setSourcePath(event.target.value)
                    clearFieldError('keystore')
                  }}
                  placeholder="把签名文件拖到这里，或点右侧按钮选择"
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
                会复制一份到本工具的数据目录，之后签名只用这份副本；原文件移走也不影响出包。
              </p>
              {fieldErrors.keystore ? (
                <p className="text-xs text-destructive">请先选择签名文件。</p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jks-source-edit">来源路径</Label>
              <div className="flex items-center gap-2">
                {/*
                  这里原先是一段纯文本，和上面那一排输入框长得一样，
                  很容易被当成「能改的框」——实际改不了，只能删掉重建。
                  现在做成明确只读的样式，旁边补上真正能改的入口。
                */}
                <Input
                  id="jks-source-edit"
                  value={sourcePath}
                  readOnly
                  aria-invalid={fieldErrors.keystore === true}
                  title={sourcePath}
                  className="bg-muted/50 text-muted-foreground"
                />
                <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()}>
                  <FileUp />
                  重新选择
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
                改路径只是把原文件指向对的地方，本工具内的副本不会跟着变。原文件换了内容，用列表里的「刷新副本」。
              </p>
              {fieldErrors.keystore ? (
                <p className="text-xs text-destructive">原文件路径有问题，看上面的提示。</p>
              ) : null}
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
                aria-invalid={fieldErrors.alias === true}
                onChange={(event) => {
                  setAlias(event.target.value)
                  clearFieldError('alias')
                }}
                placeholder="sample"
              />
              {fieldErrors.alias ? (
                <p className="text-xs text-destructive">这个别名在签名文件里找不到。</p>
              ) : null}
              {/*
                别名猜错时主进程会把文件里真正有的别名都回传，直接摆出来给用户点。
                否则用户只能从那句错误文案里抄一个再滚回去粘。
              */}
              {aliasCandidates.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">签名文件里有：</span>
                  {aliasCandidates.map((candidate) => (
                    <Button
                      key={candidate}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAlias(candidate)
                        clearFieldError('alias')
                      }}
                    >
                      {candidate}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="jks-password">密码</Label>
              <div className="relative">
                <Input
                  id="jks-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  aria-invalid={fieldErrors.password === true}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    clearFieldError('password')
                  }}
                  placeholder="sample@123"
                  className="pr-11"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="absolute top-1/2 right-0.5 -translate-y-1/2"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '查看密码明文'}
                  title={showPassword ? '隐藏密码' : '查看密码明文'}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              {fieldErrors.password ? (
                <p className="text-xs text-destructive">密码不对，或与这个别名不匹配。</p>
              ) : null}
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
                    ? '先在上面选择签名文件'
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
                      placeholder="默认等于签名文件名"
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
                    沿用渠道 JSON 的格式，渠道名原样导入，不做前缀替换。
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
                filterable
                resetFilterToken={filterResetToken}
                disabled={noJks}
                emptyHint={
                  noJks
                    ? '选择签名文件后，这里就能编辑渠道了。'
                    : channelMode === 'empty'
                      ? '还没有渠道条目。点下面的「添加一行」就能直接给它加渠道。'
                      : channelMode === 'template'
                        ? '模板为空，生成不出条目。可改用「不套用模板」手工添加。'
                        : '还没读到渠道。选一份渠道 JSON 文件就会出现在这里。'
                }
              />
            </div>
          ) : null}

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? '保存中…' : isEdit ? '保存修改' : '新增并校验'}
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
        destructive
        onConfirm={() => {
          setConfirmRegenerate(false)
          regenerateFromTemplate()
        }}
      />

      <ConfirmDialog
        open={pendingMode !== null}
        onOpenChange={(next) => (next ? undefined : setPendingMode(null))}
        title="切换渠道数据来源？"
        description={`会按新的来源重算下面的渠道列表，现在这 ${draftChannels.length} 条会被替换掉。`}
        warning="被替换的条目没有别的地方存着，撤销不了。"
        confirmText="切换并重算"
        destructive
        onConfirm={() => {
          const next = pendingMode
          setPendingMode(null)
          if (next) {
            applyMode(next)
          }
        }}
      />
    </Dialog>
  )
}
