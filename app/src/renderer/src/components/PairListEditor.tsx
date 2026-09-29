import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
}: PairListEditorProps) {
  const update = (rowId: string, patch: Partial<PairRow>) => {
    onChange(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  const remove = (rowId: string) => {
    onChange(rows.filter((row) => row.rowId !== rowId))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[45%]">{keyLabel}</TableHead>
              <TableHead className="w-[45%]">别名（选填）</TableHead>
              <TableHead className="w-[10%] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  {emptyHint}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.rowId}>
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
