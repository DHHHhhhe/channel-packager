import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** 一行「键 + 别名」。rowId 只用于 React key，不参与持久化 */
export interface PairRow {
  rowId: string
  key: string
  alias: string
}

export function newPairRow(key = '', alias = ''): PairRow {
  return { rowId: crypto.randomUUID(), key, alias }
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
}: PairListEditorProps) {
  const [picked, setPicked] = useState<string[]>([])

  /*
   * 外部整批换行时（切 jks、按模板生成、导入 JSON）旧 rowId 已经不在了。
   * 这里按当前 rows 过滤，而不是用 effect 去清 —— 省掉一次多余渲染，
   * 也不会出现「先渲染出已失效的选中数、下一帧才归零」的闪烁。
   */
  const pickedIds = useMemo(
    () => picked.filter((rowId) => rows.some((row) => row.rowId === rowId)),
    [picked, rows],
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

  const allPicked = rows.length > 0 && pickedIds.length === rows.length
  const somePicked = pickedIds.length > 0 && !allPicked
  const columnCount = selectable ? 4 : 3

  return (
    <div className="flex flex-col gap-3">
      {selectable ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {pickedIds.length > 0 ? `已选 ${pickedIds.length} 项` : `共 ${rows.length} 项`}
          </span>
          <Button variant="outline" onClick={removePicked} disabled={pickedIds.length === 0}>
            <Trash2 />
            删除选中
          </Button>
          {pickedIds.length > 0 ? (
            <Button variant="ghost" onClick={() => setPicked([])}>
              取消选择
            </Button>
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
                      setPicked(value === true ? rows.map((row) => row.rowId) : [])
                    }}
                    disabled={rows.length === 0}
                    aria-label="全选"
                    title="全选"
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-[45%]">{keyLabel}</TableHead>
              <TableHead className="w-[45%]">别名（选填）</TableHead>
              <TableHead className="w-[10%] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-muted-foreground">
                  {emptyHint}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.rowId}>
                  {selectable ? (
                    <TableCell>
                      <Checkbox
                        checked={pickedIds.includes(row.rowId)}
                        onCheckedChange={(value) => toggle(row.rowId, value === true)}
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
                      aria-invalid={row.key.trim() === ''}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row.alias}
                      onChange={(event) => update(row.rowId, { alias: event.target.value })}
                      placeholder={aliasPlaceholder}
                      aria-label="别名"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(row.rowId)}
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
        <Button variant="outline" onClick={() => onChange([...rows, newPairRow()])}>
          <Plus />
          添加一行
        </Button>
      </div>
    </div>
  )
}
