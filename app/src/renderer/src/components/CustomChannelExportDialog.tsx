import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { newPairRow, type PairRow } from '@/components/PairListEditor'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { findDuplicates } from '@/lib/duplicates'
import { useAppStore } from '@/store/app-store'
import { parseChannelConfig } from '@shared/utils/channels'
import type { ChannelEntry, GroupItem } from '@shared/types/store'

/** 确认后交回调用方的东西：这次出包用什么、要不要顺手沉淀进分组 */
export interface CustomChannelExportPayload {
  /** 这次真正写进包的渠道条目 */
  channels: ChannelEntry[]
  /** 要并入的目标分组 id；'' = 这次不往分组里存 */
  groupId: string
  /** 并进目标分组的那几条 —— 只含勾中的、且分组里还没有的 */
  rowsToSave: ChannelEntry[]
}

interface CustomChannelExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 可存入的分组。只列已有的 —— 建 / 改 / 删分组仍在「渠道配置」页 */
  groups: GroupItem[]
  /** 目标分组的默认值：当前所选分组 */
  defaultGroupId: string
  /** 「重跑本次」把上次那份自定义列表带回来；null = 从空开始 */
  initial: { channels: ChannelEntry[] } | null
  busy?: boolean
  onConfirm: (payload: CustomChannelExportPayload) => void
  /** 一个分组都没有时给条去「渠道配置」的路 */
  onGoChannels: () => void
}

/**
 * 自定义渠道出包。
 *
 * 给「这次只想打几个渠道、不想先建分组」留的逃生口：在弹窗里临时导入一份 JSON
 * 或手写几个渠道号，确认后**直接用这份列表出包**。
 *
 * 这份列表默认不落盘 —— 只有勾了「存入分组」的条目会在确认时追加进所选分组
 * （同渠道号跳过、不动原别名）。所以这里不做「覆盖」选项：一个弹窗顺手改掉
 * 分组的全量列表太危险了，要改全量请去「渠道配置」页。
 */
export function CustomChannelExportDialog({
  open,
  onOpenChange,
  groups,
  defaultGroupId,
  initial,
  busy = false,
  onConfirm,
  onGoChannels,
}: CustomChannelExportDialogProps): React.JSX.Element {
  const { getChannels } = useAppStore()

  const [rows, setRows] = useState<PairRow[]>([])
  const [targetGroupId, setTargetGroupId] = useState('')
  /** 勾了「存入分组」的行 rowId */
  const [storeIds, setStoreIds] = useState<string[]>([])
  /** 目标分组已有的条目，用来算「将新增 N 条 / 已存在 M 条跳过」 */
  const [existing, setExisting] = useState<ChannelEntry[]>([])
  const [importError, setImportError] = useState('')
  const [importName, setImportName] = useState('')
  /** 动过的行 rowId：没动过的行不该一打开就顶着红框 */
  const [touchedIds, setTouchedIds] = useState<string[]>([])
  /** 点过一次「确认」：这之后再报红才是「你想提交但没填完」 */
  const [attempted, setAttempted] = useState(false)
  /** 表里已有内容时，导入要先问一句；问之前的这份先寄存在这里 */
  const [pendingImport, setPendingImport] = useState<{
    fileName: string
    list: ChannelEntry[]
  } | null>(null)
  /** 导入前那一版，用来「撤销导入」 */
  const [undoImport, setUndoImport] = useState<{ rows: PairRow[]; storeIds: string[] } | null>(null)

  /*
   * 每次打开都回到「这次要用的那份列表」。
   *
   * 刻意不把 groups 放进依赖：分组列表变了不该把用户正在敲的内容清掉，
   * 而 targetGroupId 的兜底只在打开这一刻有意义。
   */
  useEffect(() => {
    if (!open) {
      return
    }
    setRows(initial ? initial.channels.map((entry) => newPairRow(entry.channel, entry.alias ?? '')) : [newPairRow()])
    setTargetGroupId(defaultGroupId !== '' ? defaultGroupId : (groups[0]?.id ?? ''))
    setStoreIds([])
    setImportError('')
    setImportName('')
    setTouchedIds([])
    setAttempted(false)
    setPendingImport(null)
    setUndoImport(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultGroupId])

  /* 目标分组换了就重新读它的条目 —— 「已存在几条」得按分组当下的内容算 */
  useEffect(() => {
    if (!open || targetGroupId === '') {
      setExisting([])
      return
    }
    let cancelled = false
    getChannels(targetGroupId)
      .then((config) => {
        if (!cancelled) {
          setExisting(config.channelInfoList)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExisting([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, targetGroupId, getChannels])

  const hasEmpty = rows.some((row) => row.key.trim() === '')
  const duplicates = useMemo(() => findDuplicates(rows.map((row) => row.key)), [rows])

  /*
   * 红字只在点过「确认」之后出现。
   *
   * 弹窗一打开就摆一张空行、同时报红「有渠道号还空着的行」，说的是设计者
   * 自己的事 —— 用户还没开始填。所以初始态用中性灰字交代怎么填，
   * 真有问题再变红。
   *
   * 刻意不跟「离开过某行」（touchedIds）联动：点「取消」时输入框会先失焦，
   * 那条红字就跟着冒出来，看着像「点取消反而被报错」。行里那圈红边
   * （aria-invalid）仍旧按 touchedIds 走 —— 它不改变布局，不会挪动按钮。
   */
  const showEmptyWarning = hasEmpty && attempted

  const toEntry = (row: PairRow): ChannelEntry => {
    const channel = row.key.trim()
    const alias = row.alias.trim()
    return alias ? { channel, alias } : { channel }
  }

  /** 这次写进包的条目：表里所有填了渠道号的行，与「存入分组」无关 */
  const channels = useMemo(
    () => rows.filter((row) => row.key.trim() !== '').map(toEntry),
    [rows],
  )

  const existingKeys = useMemo(
    () => new Set(existing.map((entry) => entry.channel.trim().toLowerCase())),
    [existing],
  )

  const checkedRows = rows.filter((row) => storeIds.includes(row.rowId) && row.key.trim() !== '')
  const toAdd = checkedRows.filter((row) => !existingKeys.has(row.key.trim().toLowerCase()))
  const toSkip = checkedRows.length - toAdd.length
  const rowsToSave = toAdd.map(toEntry)

  const targetGroup = groups.find((item) => item.id === targetGroupId)
  const canConfirm =
    !busy &&
    rows.length > 0 &&
    !hasEmpty &&
    duplicates.length === 0 &&
    (toAdd.length === 0 || targetGroupId !== '')
  /*
   * 按钮真的置灰的情况：正在出包、表里一行都没有、勾了「存入分组」却还没有分组。
   * 空行与重复**不**置灰 —— 那两种能靠一次点击把原因显示出来。
   */
  const hardBlocked = busy || rows.length === 0 || (toAdd.length > 0 && targetGroupId === '')

  /** 表里已经有用户敲进去的东西 —— 导入会把它整片换掉，所以要先问 */
  const hasContent = rows.some((row) => row.key.trim() !== '' || row.alias.trim() !== '')

  const applyImport = (list: ChannelEntry[], fileName: string): void => {
    // 记下这一版，导入后悔了能退回去
    setUndoImport({ rows, storeIds })
    setRows(list.length > 0 ? list.map((entry) => newPairRow(entry.channel, entry.alias ?? '')) : [newPairRow()])
    setImportName(fileName)
    setImportError('')
    setStoreIds([])
    setTouchedIds([])
    setAttempted(false)
  }

  const handleImport = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    try {
      const parsed = parseChannelConfig(await file.text(), file.name)
      if (hasContent) {
        // 已经填了东西就先问；确认后再真的换
        setPendingImport({ fileName: file.name, list: parsed.channelInfoList })
        setImportError('')
        return
      }
      applyImport(parsed.channelInfoList, file.name)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '这份渠道 JSON 读不出来。')
    }
  }

  const confirmImport = (): void => {
    if (pendingImport === null) {
      return
    }
    applyImport(pendingImport.list, pendingImport.fileName)
    setPendingImport(null)
  }

  const undoLastImport = (): void => {
    if (undoImport === null) {
      return
    }
    setRows(undoImport.rows)
    setStoreIds(undoImport.storeIds)
    setImportName('')
    setUndoImport(null)
  }

  const update = (rowId: string, patch: Partial<PairRow>): void => {
    setRows((previous) => previous.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  const remove = (rowId: string): void => {
    setRows((previous) => previous.filter((row) => row.rowId !== rowId))
    setStoreIds((previous) => previous.filter((entry) => entry !== rowId))
  }

  const toggleStore = (rowId: string, checked: boolean): void => {
    setStoreIds((previous) =>
      checked ? [...previous, rowId] : previous.filter((entry) => entry !== rowId),
    )
  }

  const noGroups = groups.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>自定义渠道出包</DialogTitle>
          <DialogDescription>
            临时配一份渠道列表，确认后直接用它出包。这份列表默认不保存，只有勾选
            「存入分组」的条目会追加进所选分组。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer">
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
              <Upload className="size-4" />
              导入渠道 JSON
            </span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(event) => {
                void handleImport(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          <span className="text-xs text-muted-foreground">
            {importName !== '' ? `已读取 ${importName}` : '或直接在下面手写渠道号'}
          </span>
          {undoImport !== null ? (
            <Button variant="ghost" size="sm" onClick={undoLastImport} disabled={busy}>
              撤销导入
            </Button>
          ) : null}
        </div>

        {importError !== '' ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>{importError}</span>
          </p>
        ) : null}

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">渠道号</TableHead>
                <TableHead className="w-[30%]">别名（选填）</TableHead>
                <TableHead className="w-[20%]">存入分组</TableHead>
                <TableHead className="w-[10%] text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    还没有渠道号。导入一份 JSON，或点下面的「添加一行」。
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.rowId}>
                    <TableCell>
                      <Input
                        value={row.key}
                        onChange={(event) => update(row.rowId, { key: event.target.value })}
                        onBlur={() =>
                          setTouchedIds((previous) =>
                            previous.includes(row.rowId) ? previous : [...previous, row.rowId],
                          )
                        }
                        placeholder="例如 sample_gf"
                        aria-label="渠道号"
                        aria-invalid={
                          row.key.trim() === '' && (attempted || touchedIds.includes(row.rowId))
                        }
                        disabled={busy}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.alias}
                        onChange={(event) => update(row.rowId, { alias: event.target.value })}
                        placeholder="例如 官方"
                        aria-label="别名"
                        disabled={busy}
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={storeIds.includes(row.rowId)}
                        onCheckedChange={(value) => toggleStore(row.rowId, value === true)}
                        disabled={busy || noGroups || row.key.trim() === ''}
                        aria-label={`把 ${row.key.trim() || '这一行'} 存入分组`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(row.rowId)}
                        disabled={busy}
                        aria-label="删除这一行"
                        title="删除这一行"
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div>
          <Button
            variant="outline"
            onClick={() => setRows((previous) => [...previous, newPairRow()])}
            disabled={busy}
          >
            <Plus />
            添加一行
          </Button>
        </div>

        {/*
          中性提示与红字用同一个框、同一份高度：红字是失焦那一刻冒出来的，
          如果它同时把下面的按钮往下推，鼠标抬起就落在别处，点击不生效 ——
          表现成「点取消没关掉，反而冒出红字」。
        */}
        {hasEmpty ? (
          <p
            className={
              showEmptyWarning
                ? 'flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive'
                : 'flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'
            }
          >
            {showEmptyWarning ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> : null}
            <span>
              {showEmptyWarning
                ? '有渠道号还空着的行，补全或删除后才能确认。'
                : '每行填一个渠道号，别名选填；填完点「确认并用它出包」。'}
            </span>
          </p>
        ) : null}

        {duplicates.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>渠道号重复：{duplicates.join('、')}</span>
          </p>
        ) : null}

        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm text-muted-foreground">勾了「存入分组」的条目</span>
          {noGroups ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>还没有分组，这次出包的结果不会保存下来。</span>
              <Button variant="outline" size="sm" onClick={onGoChannels} disabled={busy}>
                去「渠道配置」
              </Button>
            </div>
          ) : (
            <>
              <Select value={targetGroupId} onValueChange={setTargetGroupId} disabled={busy}>
                <SelectTrigger aria-label="存入哪个分组">
                  <SelectValue placeholder="选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.appLabel ? `${item.name}（${item.appLabel}）` : item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm">
                <span className="text-muted-foreground">将新增 </span>
                <span className="font-medium tabular-nums">{toAdd.length}</span>
                <span className="text-muted-foreground"> 条</span>
                {toSkip > 0 ? (
                  <>
                    <span className="text-muted-foreground">，已存在 </span>
                    <span className="font-medium tabular-nums">{toSkip}</span>
                    <span className="text-muted-foreground"> 条跳过</span>
                  </>
                ) : null}
                {targetGroup ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · 追加进「{targetGroup.name}」，同渠道号跳过，不改动原有别名
                  </span>
                ) : null}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          {attempted && !canConfirm && !hardBlocked ? (
            <span className="mr-auto self-center text-xs text-destructive">
              {hasEmpty ? '还有空的渠道号，补全或删掉那一行。' : '渠道号有重复，改掉后才能确认。'}
            </span>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button
            onClick={() => {
              /*
               * 空行 / 重复时按钮不置灰：置灰只是「点不动」，人不知道差在哪。
               * 让这一次点击把红字顶出来，比什么都不发生清楚。
               */
              if (!canConfirm) {
                setAttempted(true)
                return
              }
              onConfirm({ channels, groupId: targetGroupId, rowsToSave })
            }}
            disabled={hardBlocked}
          >
            {busy ? <Spinner /> : null}
            {busy ? '正在出包…' : '确认并用它出包'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={pendingImport !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingImport(null)
          }
        }}
        title="用这份 JSON 换掉表里的内容？"
        description={`导入会替换当前表里 ${rows.length} 行。`}
        warning="正在编辑的内容没有别的地方存着，替换后要靠「撤销导入」退回。"
        confirmText="替换"
        destructive
        onConfirm={confirmImport}
      />
    </Dialog>
  )
}
