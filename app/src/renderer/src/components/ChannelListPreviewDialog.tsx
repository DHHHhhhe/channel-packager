import { useEffect, useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { findDuplicates } from '@/lib/duplicates'
import type { ChannelImportMode, ChannelListPreview } from '@shared/types/pack'

interface ChannelListPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 对话框标题，如「导入渠道 JSON」 */
  title: string
  /** 解析出来的文件内容；null 表示还没读到 */
  preview: ChannelListPreview | null
  /** 界面现有条数，用来提示会变成多少条。不显示处理方式时用不到 */
  currentCount?: number
  busy?: boolean
  /**
   * 对界面现有列表的处理方式。**不传就不显示这一段** ——
   * 「新增 jks」里那份草稿本来就从空开始，覆盖与追加没有区别，多一个选择只会让人犹豫。
   */
  mode?: ChannelImportMode
  onModeChange?: (mode: ChannelImportMode) => void
  /** 确认时把用户改过的条目交回去；由调用方决定怎么合并、什么时候落盘 */
  onConfirm: (rows: PairRow[]) => void
}

/**
 * 「导入前先看一眼」的预览框。
 *
 * 导入只把条目填进界面，**不写文件**，所以这里做三件事：
 * 把文件里的条目列出来、允许就地改（增删改都行）、确认后交给调用方合并。
 * 覆盖/追加是可选的：只有界面上已经有一份列表时才有意义。
 */
export function ChannelListPreviewDialog({
  open,
  onOpenChange,
  title,
  preview,
  currentCount = 0,
  busy = false,
  mode,
  onModeChange,
  onConfirm,
}: ChannelListPreviewDialogProps): React.JSX.Element {
  /*
   * 条目在这里是一份可编辑的副本。
   * 用 effect 而不是 useState 初值：同一个对话框会被反复打开（换文件、换 jks），
   * 每次都要回到「文件里原本是什么」。
   */
  const [edited, setEdited] = useState<PairRow[]>([])

  useEffect(() => {
    if (!open) {
      return
    }
    setEdited(
      (preview?.channels ?? []).map((entry) => newPairRow(entry.channel, entry.alias ?? '')),
    )
  }, [open, preview])

  const count = edited.length
  const hasEmpty = edited.some((row) => row.key.trim() === '')
  const duplicates = useMemo(() => findDuplicates(edited.map((row) => row.key)), [edited])

  const showMode = mode !== undefined
  const overwrite = mode !== 'append'
  // 覆盖 + 文件里一条都没有：界面列表会被清空，这个副作用必须说出来
  const clearing = showMode && overwrite && count === 0 && currentCount > 0
  const canConfirm = preview !== null && !busy && !hasEmpty && duplicates.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      {/*
        宽度必须带 sm: 前缀 —— 基础样式的 sm:max-w-sm 会盖掉裸的 max-w-2xl，
        预览框里是一张四列表格，窄了没法用。
        布局也覆盖掉基础样式的 grid + overflow-y-auto：这里要的是「标题、处理方式、
        底部按钮都钉住，只有表格区滚」—— 几百条时按钮不会再被滚到看不见。
      */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {preview
              ? showMode
                ? `从「${preview.fileName}」读到 ${preview.count} 条渠道。${
                    overwrite
                      ? '确认后替换界面列表里的内容。'
                      : '确认后与界面列表合并，同名渠道不重复。'
                  }需要再点「保存渠道列表」才会写入文件。`
                : `从「${preview.fileName}」读到 ${preview.count} 条渠道，可在下面直接改。`
              : '还没有读到内容。'}
          </DialogDescription>
        </DialogHeader>

        {showMode ? (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm text-muted-foreground">对界面上现有的 {currentCount} 条渠道</span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={overwrite ? 'default' : 'outline'}
                aria-pressed={overwrite}
                disabled={busy}
                onClick={() => onModeChange?.('overwrite')}
              >
                覆盖
              </Button>
              <Button
                type="button"
                size="sm"
                variant={overwrite ? 'outline' : 'default'}
                aria-pressed={!overwrite}
                disabled={busy}
                onClick={() => onModeChange?.('append')}
              >
                追加
              </Button>
              <span className="text-sm text-muted-foreground">
                {overwrite ? '清空后只保留文件里的条目' : '保留现有条目，只补文件里多出来的'}
              </span>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-muted-foreground">当前</span>
              <span className="font-medium tabular-nums">{currentCount}</span>
              <span className="text-muted-foreground">条</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">导入后</span>
              <span className="font-medium tabular-nums">
                {overwrite ? count : `最多 ${currentCount + count}`}
              </span>
              <span className="text-muted-foreground">条</span>
            </p>
          </div>
        ) : null}

        {clearing ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>文件里一条渠道都没有，覆盖会把界面上的 {currentCount} 条全部清掉。</span>
          </p>
        ) : null}

        {hasEmpty ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>有渠道名还空着的行，补全或删除后才能确认。</span>
          </p>
        ) : null}

        {duplicates.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>渠道名重复：{duplicates.join('、')}</span>
          </p>
        ) : null}

        {/*
          只有这一块滚：几百条时「覆盖 / 追加」的选择与下面的按钮都还看得见。
          min-h-0 不能少 —— flex 子项默认 min-height:auto，不加它这一块会把
          对话框撑开，滚动条就落到外层去了。
        */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {preview && preview.notes.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {preview.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          ) : null}

          <PairListEditor
            rows={edited}
            onChange={setEdited}
            keyLabel="渠道名"
            keyPlaceholder="例如 sample_gf"
            aliasPlaceholder="例如 官方"
            emptyHint="文件里没有渠道条目。可点上面的「添加一行」手工补一条。"
            selectable
            filterable
            scrollTable={false}
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => onConfirm(edited)} disabled={!canConfirm}>
            {busy ? <Spinner /> : null}
            {busy ? '导入中…' : showMode ? (overwrite ? '覆盖导入' : '追加导入') : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
