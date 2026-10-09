import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Plus, Search, Trash2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { viewPairRows, type RowSort } from '@/lib/row-view'

/** 一行「键 + 别名」。rowId 只用于 React key，不参与持久化 */
export interface PairRow {
  rowId: string
  key: string
  alias: string
}

export function newPairRow(key = '', alias = ''): PairRow {
  return { rowId: crypto.randomUUID(), key, alias }
}

/**
 * 把粘贴进来的一大段文本拆成行。
 *
 * 一行一条，键与别名之间用空格、逗号（中英文）或制表符隔开都认 ——
 * 从表格软件里复制出来的多半是制表符，手写的多半是空格或逗号。
 * 空行跳过；只有键没有别名的行也收，别名本来就选填。
 */
function parseBulkText(text: string): { key: string; alias: string }[] {
  const parsed: { key: string; alias: string }[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      continue
    }
    const parts = line.split(/[\s,，\t]+/)
    const key = (parts[0] ?? '').trim()
    if (key === '') {
      continue
    }
    parsed.push({ key, alias: parts.slice(1).join(' ').trim() })
  }
  return parsed
}

interface PairListEditorProps {
  rows: PairRow[]
  onChange: (rows: PairRow[]) => void
  keyLabel: string
  keyPlaceholder: string
  aliasPlaceholder: string
  emptyHint: string
  /** 打开多选：表头出现全选框，选中若干行后可一次删掉 */
  selectable?: boolean
  /** 整块只读：新增、编辑、删除与多选全部禁用（如「新增 jks」还没选 jks 文件时） */
  disabled?: boolean
  /** 打开搜索与排序。纯显示层，rows 与 onChange 拿到的仍是完整列表 */
  filterable?: boolean
  /**
   * 变化时把搜索与排序清掉。给「保存失败、问题行被搜索藏起来了」这类场景用：
   * 调用方把出错的行指出来之前先递增一下，用户才看得见那一行。
   */
  resetFilterToken?: number
  /**
   * 已经重复的键（忽略大小写与首尾空白）。传进来就当场把这几行标红 ——
   * 去重校验本来只有保存时才跑，用户得点一次保存才知道哪行撞了。
   */
  duplicates?: string[]
  /** 打开「批量粘贴」：从表格软件或文档里一次贴一整批进来 */
  bulkPaste?: boolean
}

/**
 * 模板页与渠道页都是「一行一个键 + 可选别名」的表格，编辑行为完全一致，
 * 抽成一个组件，避免两处各写一份增删改。
 */
export function PairListEditor({
  rows,
  onChange,
  keyLabel,
  keyPlaceholder,
  aliasPlaceholder,
  emptyHint,
  selectable = false,
  disabled = false,
  filterable = false,
  resetFilterToken = 0,
  duplicates,
  bulkPaste = false,
}: PairListEditorProps) {
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RowSort>('none')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const visibleRows = useMemo(() => viewPairRows(rows, query, sort), [rows, query, sort])
  const filtering = filterable && (query.trim() !== '' || sort !== 'none')

  /* 重复的键先归一化，表格里逐行判断用得上 */
  const duplicateKeys = useMemo(
    () => new Set((duplicates ?? []).map((value) => value.trim().toLowerCase())),
    [duplicates],
  )
  const isDuplicate = (key: string): boolean => {
    const normalized = key.trim().toLowerCase()
    return normalized !== '' && duplicateKeys.has(normalized)
  }

  /* 批量粘贴的预览：解析出来多少条、其中多少条会撞上现有条目或彼此 */
  const bulkRows = useMemo(() => parseBulkText(bulkText), [bulkText])
  const bulkDuplicateCount = useMemo(() => {
    const taken = new Set(
      rows.map((row) => row.key.trim().toLowerCase()).filter((key) => key !== ''),
    )
    let duplicated = 0
    for (const row of bulkRows) {
      const key = row.key.trim().toLowerCase()
      if (taken.has(key)) {
        duplicated += 1
      }
      taken.add(key)
    }
    return duplicated
  }, [bulkRows, rows])

  const openBulk = () => {
    setBulkText('')
    setBulkOpen(true)
  }

  const confirmBulk = () => {
    if (bulkRows.length === 0) {
      return
    }
    onChange([...rows, ...bulkRows.map((row) => newPairRow(row.key, row.alias))])
    // 新行多半匹配不上当前搜索词；不清掉会让人以为一条都没加上
    setQuery('')
    setBulkOpen(false)
    setBulkText('')
  }

  /*
   * 整份列表被换掉时（按模板生成、导入 JSON、切 jks）把搜索与排序清掉。
   * 不清的话，新列表里只剩零星几行显示着，看着像生成失败。
   *
   * 判据是「旧行一个都不在了」而不是「rows 变了」：逐字改一行、删一行时
   * rowId 大部分还在，不该把用户正用着的搜索词清掉。
   */
  const lastRowIdsRef = useRef<string[]>([])
  useEffect(() => {
    const currentIds = rows.map((row) => row.rowId)
    const replaced = !currentIds.some((rowId) => lastRowIdsRef.current.includes(rowId))
    lastRowIdsRef.current = currentIds
    if (replaced) {
      setQuery('')
      setSort('none')
    }
  }, [rows])

  /* 调用方要求「把藏起来的行露出来」时清掉筛选 */
  useEffect(() => {
    setQuery('')
    setSort('none')
  }, [resetFilterToken])

  /*
   * 外部整批换行时（切 jks、按模板生成、导入 JSON）旧 rowId 已经不在了。
   * 这里按当前显示的行过滤，而不是用 effect 去清 —— 省掉一次多余渲染，
   * 也不会出现「先渲染出已失效的选中数、下一帧才归零」的闪烁。
   *
   * 这里按 visibleRows 而不是 rows：被搜索藏起来的行若还留在 picked 里，
   * 一点「删除选中」就会连看不见的行一起删掉。
   */
  const pickedIds = useMemo(
    () => picked.filter((rowId) => visibleRows.some((row) => row.rowId === rowId)),
    [picked, visibleRows],
  )

  const update = (rowId: string, patch: Partial<PairRow>) => {
    onChange(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  const remove = (rowId: string) => {
    onChange(rows.filter((row) => row.rowId !== rowId))
  }

  const toggle = (rowId: string, checked: boolean) => {
    setPicked(
      checked ? [...pickedIds, rowId] : pickedIds.filter((entry) => entry !== rowId),
    )
  }

  const removePicked = () => {
    onChange(rows.filter((row) => !pickedIds.includes(row.rowId)))
    setPicked([])
  }

  /* 换了搜索词或排序，原来选中的行可能已经不在眼前了，顺手清掉选择 */
  const changeQuery = (next: string) => {
    setQuery(next)
    setPicked([])
  }

  const changeSort = (next: RowSort) => {
    setSort(next)
    setPicked([])
  }

  const clearFilter = () => {
    setQuery('')
    setSort('none')
    setPicked([])
  }

  const addRow = () => {
    onChange([...rows, newPairRow()])
    // 新行是空的，多半匹配不上当前搜索词；不把它露出来会让人以为没加上
    setQuery('')
  }

  const allPicked = visibleRows.length > 0 && pickedIds.length === visibleRows.length
  const somePicked = pickedIds.length > 0 && !allPicked
  const columnCount = selectable ? 4 : 3
  const countText =
    pickedIds.length > 0
      ? `已选 ${pickedIds.length} 项`
      : filtering
        ? `显示 ${visibleRows.length} / 共 ${rows.length} 项`
        : `共 ${rows.length} 项`

  return (
    <div className="flex flex-col gap-3">
      {filterable ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder={`搜${keyLabel}或别名`}
                aria-label="搜索条目"
                className="w-56 pl-8"
                disabled={disabled}
              />
            </div>
            <Select value={sort} onValueChange={(value) => changeSort(value as RowSort)}>
              <SelectTrigger aria-label="排序方式" className="w-32" disabled={disabled}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">按原顺序</SelectItem>
                <SelectItem value="key">按{keyLabel}</SelectItem>
                <SelectItem value="alias">按别名</SelectItem>
              </SelectContent>
            </Select>
            {filtering ? (
              <Button variant="ghost" onClick={clearFilter} disabled={disabled}>
                清空
              </Button>
            ) : null}
          </div>
          {filtering ? (
            <p className="text-xs text-muted-foreground">
              搜索与排序只改显示，保存的仍是全部 {rows.length} 项。
            </p>
          ) : null}
        </div>
      ) : null}

      {selectable || filterable || duplicateKeys.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{countText}</span>
          {duplicateKeys.size > 0 ? (
            <span className="text-sm text-destructive">
              有 {duplicateKeys.size} 个重复的{keyLabel}，已标红
            </span>
          ) : null}
          {selectable ? (
            <>
              <Button
                variant="outline"
                onClick={removePicked}
                disabled={disabled || pickedIds.length === 0}
              >
                <Trash2 />
                删除选中
              </Button>
              {pickedIds.length > 0 ? (
                <Button variant="ghost" onClick={() => setPicked([])} disabled={disabled}>
                  取消选择
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={somePicked ? 'indeterminate' : allPicked}
                    onCheckedChange={(value) => {
                      setPicked(value === true ? visibleRows.map((row) => row.rowId) : [])
                    }}
                    disabled={disabled || visibleRows.length === 0}
                    aria-label="全选"
                    title={filtering ? '全选显示中的行' : '全选'}
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-[45%]">{keyLabel}</TableHead>
              <TableHead className="w-[45%]">别名（选填）</TableHead>
              <TableHead className="w-[10%] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-muted-foreground">
                  {rows.length === 0
                    ? emptyHint
                    : `没有匹配「${query.trim()}」的条目。换个词，或点「清空」。`}
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => (
                <TableRow
                  key={row.rowId}
                  className={isDuplicate(row.key) ? 'bg-destructive/5' : undefined}
                >
                  {selectable ? (
                    <TableCell>
                      <Checkbox
                        checked={pickedIds.includes(row.rowId)}
                        onCheckedChange={(value) => toggle(row.rowId, value === true)}
                        disabled={disabled}
                        aria-label={`选中 ${row.key.trim() || '这一行'}`}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <Input
                      value={row.key}
                      onChange={(event) => update(row.rowId, { key: event.target.value })}
                      placeholder={keyPlaceholder}
                      aria-label={keyLabel}
                      aria-invalid={row.key.trim() === '' || isDuplicate(row.key)}
                      title={isDuplicate(row.key) ? `这个${keyLabel}与别的行重复了` : undefined}
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row.alias}
                      onChange={(event) => update(row.rowId, { alias: event.target.value })}
                      placeholder={aliasPlaceholder}
                      aria-label="别名"
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(row.rowId)}
                      disabled={disabled}
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

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={addRow} disabled={disabled}>
          <Plus />
          添加一行
        </Button>
        {bulkPaste ? (
          <Button variant="outline" onClick={openBulk} disabled={disabled}>
            <ClipboardPaste />
            批量粘贴
          </Button>
        ) : null}
      </div>

      {bulkPaste ? (
        <Dialog open={bulkOpen} onOpenChange={(open) => (open ? undefined : setBulkOpen(false))}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>批量粘贴{keyLabel}</DialogTitle>
              <DialogDescription>
                一行一条：{keyLabel}，或者 {keyLabel} 加别名。中间用空格、逗号或制表符隔开都行。
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={'gf 官方\nhw 华为\noppo'}
              aria-label="批量粘贴内容"
              rows={8}
            />
            <p className="text-xs text-muted-foreground">
              {bulkRows.length === 0
                ? '还没有内容。'
                : bulkDuplicateCount > 0
                  ? `解析出 ${bulkRows.length} 条，其中 ${bulkDuplicateCount} 条与现有条目或彼此重复，追加后要手工改掉。`
                  : `解析出 ${bulkRows.length} 条，没有重复。`}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkOpen(false)}>
                取消
              </Button>
              <Button onClick={confirmBulk} disabled={bulkRows.length === 0}>
                追加 {bulkRows.length} 条
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
