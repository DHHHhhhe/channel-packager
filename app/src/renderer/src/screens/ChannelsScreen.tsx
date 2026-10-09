import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleCheck,
  FileDown,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from 'lucide-react'
import { ChannelListPreviewDialog } from '@/components/ChannelListPreviewDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { GroupFormDialog, type GroupFormPayload } from '@/components/GroupFormDialog'
import { PageHeader } from '@/components/PageHeader'
import { PairListEditor, newPairRow, type PairRow } from '@/components/PairListEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChannelEntry, GroupItem } from '@shared/types/store'
import type { ChannelImportMode, ChannelListPreview } from '@shared/types/pack'
import { buildChannelsFromTemplate } from '@shared/utils/channels'
import { mergeImportedRows } from '@/lib/channels-import'
import { findDuplicateGroups } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { dirName } from '@/lib/paths'
import { useAppStore } from '@/store/app-store'
import { useSaveShortcut, useUnsavedGuard } from '@/store/nav'

/** 编辑器里的行 → 落盘/导出用的条目；别名为空时不写这个字段 */
function toChannelEntries(rows: PairRow[]): ChannelEntry[] {
  return rows.map((row) => {
    const alias = row.alias.trim()
    return alias ? { channel: row.key.trim(), alias } : { channel: row.key.trim() }
  })
}

/** 把「第几行」拼成一句人话：第 12、15 行；太多了就只报处数 */
function describeRows(indices: readonly number[]): string {
  const shown = indices.slice(0, 5).map((index) => index + 1)
  if (indices.length > shown.length) {
    return `第 ${shown.join('、')} 行等 ${indices.length} 处`
  }
  return `第 ${shown.join('、')} 行`
}

export function ChannelsScreen() {
  const { groups, channelsRevision, template, getChannels, saveChannels, saveGroup } = useAppStore()
  const [selectedId, setSelectedId] = useState('')
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error'
    text: string
    /** 有值时给一个「打开所在目录」按钮 —— 导出后只甩一条路径等于让人自己去翻 */
    path?: string
    /** 「撤销生成」这类出口 */
    action?: { label: string; run: () => void }
  } | null>(null)
  /** 正在读导入的文件：读大文件要一点时间，按钮得给个动静 */
  const [importing, setImporting] = useState(false)
  /** 保存被拦下时出问题的行，加一层底色并滚过去 */
  const [errorRowIds, setErrorRowIds] = useState<string[]>([])
  /** 已解析待确认的导入；null 表示没有待确认的导入 */
  const [pending, setPending] = useState<ChannelListPreview | null>(null)
  /** 预览框里选的覆盖/追加，默认覆盖 */
  const [importMode, setImportMode] = useState<ChannelImportMode>('overwrite')
  /** 「按模板生成」会整表替换，有未保存改动时先问一声 */
  const [confirmTemplate, setConfirmTemplate] = useState(false)
  /** 递增一下就让渠道列表把搜索清掉 —— 保存被拦下时，问题行可能正被搜索藏着 */
  const [filterResetToken, setFilterResetToken] = useState(0)
  /** 分组表单：editing 为 null 表示新建 */
  const [groupForm, setGroupForm] = useState<{ open: boolean; editing: GroupItem | null }>({
    open: false,
    editing: null,
  })
  const [groupBusy, setGroupBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 有未保存改动时想切分组，先拦在这里；值是打算切过去的 id */
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null)

  const selected = groups.find((item) => item.id === selectedId)

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedId('')
      return
    }
    if (!groups.some((item) => item.id === selectedId)) {
      setSelectedId(groups[0].id)
    }
  }, [groups, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    setStatus(null)
    // 换分组后旧的导入确认框已经没意义了
    setPending(null)
    setErrorRowIds([])
    getChannels(selectedId)
      .then((config) => {
        if (cancelled) {
          return
        }
        setRows(
          config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')),
        )
        setDirty(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus({ kind: 'error', text: ipcErrorMessage(error) })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, getChannels])

  // 换分组时把前缀清空 —— 前缀由用户按这次要出的渠道自己填，不给默认值
  useEffect(() => {
    setPrefix('')
  }, [selectedId])

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  /** 上一次回读对应的保存次数 */
  const readRevisionRef = useRef(channelsRevision)
  /** 刚由本页面保存过，那次保存次数变化不用再回读一次 */
  const skipReadRef = useRef(false)

  /*
   * 别的页面也会往同一个分组里存渠道 —— 出包页的「自定义渠道导出」就会。
   * 四个页面现在一直挂着，切回来不会再重新挂载，所以得自己盯着保存次数重读一次。
   *
   * 手上有没保存的改动时不动它：那正是要保下来的东西，冲掉就等于又犯了一次
   * 「切一下就丢改动」。这里是后台补读，失败也不打扰正在编辑的人。
   */
  useEffect(() => {
    if (readRevisionRef.current === channelsRevision) {
      return
    }
    readRevisionRef.current = channelsRevision
    if (skipReadRef.current) {
      skipReadRef.current = false
      return
    }
    if (!selectedId || dirtyRef.current) {
      return
    }
    let cancelled = false
    getChannels(selectedId)
      .then((config) => {
        if (cancelled) {
          return
        }
        setRows(
          config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')),
        )
      })
      .catch(() => {
        // 只是补读，失败就维持现状
      })
    return () => {
      cancelled = true
    }
  }, [channelsRevision, selectedId, getChannels])

  /* 重复的键，带上每一处出现的行号 —— 光说「重名了」用户还得自己去找 */
  const duplicateGroups = useMemo(
    () => findDuplicateGroups(rows.map((row) => row.key)),
    [rows],
  )
  const duplicates = useMemo(
    () => duplicateGroups.map((group) => group.value),
    [duplicateGroups],
  )
  const hasEmpty = rows.some((row) => row.key.trim() === '')

  /*
   * 生成前先让人看到会得到什么。原来只有一个按钮，点下去之前完全不知道
   * 会出来几条、长什么样。
   */
  const templatePreview = useMemo(() => {
    const list = buildChannelsFromTemplate(template.suffixes, prefix).channelInfoList
    return { total: list.length, sample: list.slice(0, 3).map((entry) => entry.channel) }
  }, [template.suffixes, prefix])

  const handleChange = (next: PairRow[]) => {
    setRows(next)
    setDirty(true)
    setStatus(null)
    // 动过之后原来的标红与滚动就过期了
    setErrorRowIds([])
  }

  /** 生成前的列表，给状态栏上的「撤销生成」留一份 */
  const beforeTemplateRef = useRef<PairRow[]>([])

  const applyTemplate = () => {
    if (!selected) {
      return
    }
    const config = buildChannelsFromTemplate(template.suffixes, prefix)
    const beforeRows = rows
    const wasDirty = dirty
    beforeTemplateRef.current = beforeRows
    setRows(config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')))
    setDirty(true)
    setErrorRowIds([])
    setStatus({
      kind: 'ok',
      text: `已按模板生成 ${config.channelInfoList.length} 条，尚未保存。`,
      action: {
        label: '撤销生成',
        run: () => {
          setRows(beforeTemplateRef.current)
          setDirty(wasDirty)
          setStatus({ kind: 'ok', text: '已退回生成前的那份列表。' })
        },
      },
    })
  }

  /*
   * 按模板生成是整表替换。只要列表里已经有东西就先问一声 ——
   * 确认框里顺带把「会生成什么」列出来，不然只能凭前缀猜。
   */
  const handleApplyTemplateClick = () => {
    if (rows.length > 0) {
      setConfirmTemplate(true)
      return
    }
    applyTemplate()
  }

  const handleExportJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      // 导的是界面上的列表，不是磁盘上那份 —— 刚导入还没保存时也能拿到看到的内容
      const result = await window.api.exportChannels(selected.id, toChannelEntries(rows))
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出 ${result.count ?? 0} 条渠道：${result.path}${
          dirty ? '（含尚未保存的修改）' : ''
        }。可直接用于批量写入渠道。`,
        path: result.path,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 导入只做「选文件 + 解析」：把文件里的条目拿回来，用户改完、选好覆盖还是追加、
   * 点确认后填进界面列表。**不写文件** —— 导入结果和手工敲进去的没区别，
   * 都要再点「保存渠道列表」才落盘，所以也不需要为「有未保存的修改」报警告。
   */
  const handleImportJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    setImporting(true)
    try {
      const result = await window.api.previewChannels()
      if (result === null) {
        return
      }
      setImportMode('overwrite')
      setPending(result)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setImporting(false)
    }
  }

  /*
   * 导出一份示例渠道 JSON。只在列表为空时可用 ——
   * 有内容时用户该做的是「导出 JSON」把现有数据拿走，示例文件只会添乱。
   */
  const handleExportSampleJson = async () => {
    if (!selected) {
      return
    }
    setStatus(null)
    try {
      const result = await window.api.exportSampleChannels(selected.id, prefix)
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出示例 ${result.count ?? 0} 条：${result.path}${
          result.fromTemplate ? '（条目取自「渠道模板」页的模板）' : '（模板为空，用的是内置兜底示例）'
        }。改好后用「导入 JSON」读回来。`,
        path: result.path,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /** 预览框里点确认：把改过的条目合并进界面列表，等用户点保存才落盘 */
  const handleConfirmImport = (imported: PairRow[]) => {
    const before = rows.length
    const merged = mergeImportedRows(rows, imported, importMode)
    setRows(merged.rows)
    setDirty(true)
    setPending(null)
    const detail =
      importMode === 'overwrite'
        ? `已按文件填入 ${merged.rows.length} 条，替换掉原来的 ${before} 条。`
        : `已追加 ${merged.added} 条（跳过重名 ${merged.skipped} 条），现共 ${merged.rows.length} 条。`
    setStatus({ kind: 'ok', text: `${detail}尚未保存，确认无误后点「保存渠道列表」。` })
  }

  const handleSave = useCallback(async () => {
    if (!selected) {
      return
    }
    if (hasEmpty) {
      const emptyIndices = rows.reduce<number[]>((collected, row, index) => {
        if (row.key.trim() === '') {
          collected.push(index)
        }
        return collected
      }, [])
      // 空行可能正被搜索藏起来，先把筛选清掉再报错，免得用户找不到
      setFilterResetToken((value) => value + 1)
      setErrorRowIds(emptyIndices.map((index) => rows[index].rowId))
      setStatus({
        kind: 'error',
        text: `${describeRows(emptyIndices)}的渠道名还是空的，已经标红。补全或删掉那一行再保存。`,
      })
      return
    }
    if (duplicateGroups.length > 0) {
      const detail = duplicateGroups
        .map((group) => `${group.value}（${describeRows(group.indices)}）`)
        .join('；')
      setFilterResetToken((value) => value + 1)
      setErrorRowIds(duplicateGroups.map((group) => rows[group.indices[0]].rowId))
      setStatus({ kind: 'error', text: `渠道名重复：${detail}。已经标红，改掉后才能保存。` })
      return
    }
    setSaving(true)
    try {
      await saveChannels(selected.id, {
        channelInfoList: toChannelEntries(rows),
      })
      skipReadRef.current = true
      setDirty(false)
      setErrorRowIds([])
      setStatus({ kind: 'ok', text: '渠道列表已保存。' })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }, [selected, hasEmpty, duplicateGroups, rows, saveChannels])

  /* Ctrl+S 与页面上的「保存渠道列表」走同一个动作 */
  useSaveShortcut(
    'channels',
    useCallback(() => {
      void handleSave()
    }, [handleSave]),
  )

  /* 有没保存的改动时，关窗口会被拦一下（切页不会：页面一直挂着，切回来内容还在） */
  useUnsavedGuard(dirty ? '渠道列表的改动' : null)

  /*
   * 切分组会把整张表换成另一个分组的列表。
   * 原来这里是直接 setSelectedId —— 界面上那批还没保存的改动连问都不问就没了。
   */
  const handleSelectGroup = (next: string) => {
    if (next === selectedId) {
      return
    }
    if (dirty) {
      setConfirmSwitch(next)
      return
    }
    setSelectedId(next)
  }

  const handleSubmitGroup = async (payload: GroupFormPayload) => {
    setGroupBusy(true)
    setStatus(null)
    try {
      const editing = groupForm.editing
      const result = editing
        ? await saveGroup({ action: 'update', item: { ...editing, ...payload } })
        : await saveGroup({ action: 'add', ...payload })
      setGroupForm({ open: false, editing: null })
      if (result.item) {
        // 新建后直接切过去，省得用户再去下拉里找一遍
        setSelectedId(result.item.id)
      }
      setStatus({
        kind: 'ok',
        text: editing
          ? `分组「${result.item?.name ?? payload.name}」已更新。`
          : `分组「${result.item?.name ?? payload.name}」已新建，现在可以往里面加渠道了。`,
      })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setGroupBusy(false)
    }
  }

  const handleDeleteGroup = async () => {
    if (!selected) {
      return
    }
    setGroupBusy(true)
    setStatus(null)
    try {
      const name = selected.name
      await saveGroup({ action: 'remove', id: selected.id })
      setConfirmDelete(false)
      setStatus({ kind: 'ok', text: `分组「${name}」及其渠道列表已删除。` })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setGroupBusy(false)
    }
  }

  const groupDialogs = (
    <>
      <GroupFormDialog
        open={groupForm.open}
        onOpenChange={(open) => setGroupForm({ open, editing: open ? groupForm.editing : null })}
        group={groupForm.editing}
        takenNames={groups
          .filter((item) => item.id !== groupForm.editing?.id)
          .map((item) => item.name)}
        busy={groupBusy}
        onSubmit={handleSubmitGroup}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除分组？"
        description={`会删掉「${selected?.name ?? ''}」以及它名下的 ${
          loading ? '渠道列表' : `${rows.length} 条渠道`
        }。`}
        warning={
          rows.length > 50
            ? `这个分组里有 ${rows.length} 条渠道，删掉要重新建一遍。渠道列表会一并删除，无法恢复。`
            : '渠道列表会一并删除，无法恢复。'
        }
        confirmText="删除分组"
        destructive
        onConfirm={handleDeleteGroup}
      />
    </>
  )

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader description="一个分组一份渠道列表，导出后可直接用于批量写入渠道。" />
        <Card>
          <CardHeader>
            <CardTitle>还没有分组</CardTitle>
            <CardDescription>
              分组是渠道列表的家，与签名文件无关，没有签名文件也能建。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              一个分组代表一个应用：分组名是渠道列表的名字，中文应用名只在本工具里显示、不会写进安装包。出包时选中哪个分组，就按哪个分组的渠道列表出包。
            </p>
            <p className="text-sm text-muted-foreground">
              签名文件只负责签名：需要重签名时才要用到，只写渠道时可以完全不选。
            </p>
            <p className="text-sm text-muted-foreground">
              建好之后不用一条条敲：「按模板生成」可以照「渠道模板」页的后缀一次铺出一整份列表，「导入 JSON」可以直接读入现成的列表。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setGroupForm({ open: true, editing: null })}>
                <Plus />
                新建分组
              </Button>
            </div>
          </CardContent>
        </Card>
        {groupDialogs}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="一个分组一份渠道列表，导出后可直接用于批量写入渠道。"
        actions={
          <>
            {dirty ? <span className="text-xs text-muted-foreground">有未保存的修改</span> : null}
            <Button
              variant="outline"
              onClick={handleImportJson}
              disabled={saving || loading || importing}
              title="读一份渠道 JSON 进来，先预览、改完再确认"
            >
              {importing ? <Spinner /> : null}
              {importing ? '读取中…' : '导入 JSON'}
            </Button>
            <Button
              variant="outline"
              onClick={handleExportJson}
              disabled={saving || loading || rows.length === 0}
              title={
                rows.length === 0
                  ? '渠道列表为空，没有可导出的内容'
                  : '导出界面上的渠道列表（含尚未保存的修改）'
              }
            >
              导出 JSON
            </Button>
            <Button onClick={handleSave} disabled={saving || loading || !dirty}>
              {saving ? <Spinner /> : null}
              {saving ? '保存中…' : '保存渠道列表'}
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>选择分组</CardTitle>
          <CardDescription>
            {selected
              ? selected.appLabel
                ? `中文应用名 ${selected.appLabel}`
                : '这个分组还没填中文应用名。'
              : '请选择一个分组。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="max-w-sm flex-1">
              <Select value={selectedId} onValueChange={handleSelectGroup}>
                <SelectTrigger aria-label="选择分组">
                  <SelectValue placeholder="请选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.appLabel ? `${item.name}（${item.appLabel}）` : item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setGroupForm({ open: true, editing: null })}>
              <Plus />
              新建分组
            </Button>
            <Button
              variant="outline"
              onClick={() => setGroupForm({ open: true, editing: selected ?? null })}
              disabled={!selected}
            >
              <Pencil />
              编辑
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(true)}
              disabled={!selected || saving || loading}
            >
              <Trash2 />
              删除
            </Button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="channel-prefix">渠道前缀</Label>
              <Input
                id="channel-prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                placeholder="留空则渠道名等于后缀"
                className="w-64"
              />
              {/* 点「按模板生成」之前先看到会出来什么，而不是生成完才知道 */}
              <p className="text-xs text-muted-foreground">
                {template.suffixes.length === 0
                  ? '「渠道模板」页还没有后缀，现在生成出来会是空的。'
                  : `会生成 ${templatePreview.total} 条：${templatePreview.sample.join('、')}${
                      templatePreview.total > templatePreview.sample.length ? '…' : ''
                    }`}
              </p>
            </div>
            <Button variant="outline" onClick={handleApplyTemplateClick}>
              <Wand2 />
              按模板生成
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            生成规则：渠道名 = 前缀 + &quot;_&quot; + 后缀。生成的是独立副本，之后再改模板也不会影响这里。
            列表里已经有条目时，会先把要生成的内容列出来让你确认，生成后还能在状态栏上撤销。
          </p>
          <p className="text-xs text-muted-foreground">
            「导入 JSON」会把文件里的条目读进一个预览框，可以在里面直接增删改；确认后只填进下面的列表，
            点「保存渠道列表」才落盘。
          </p>
        </CardContent>
      </Card>

      {/*
        sticky：保存按钮在页面最上面，而用户多半正滚在列表里。提示钉在顶上，
        不用滚回去才知道刚才那一下成没成。底色必须不透明，否则会被卡片透出来。
      */}
      {status ? (
        <div
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={
            status.kind === 'error'
              ? 'sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/50 bg-background px-3 py-2 text-sm text-destructive shadow-sm'
              : 'sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-success/50 bg-background px-3 py-2 text-sm text-success shadow-sm'
          }
        >
          {status.kind === 'error' ? (
            <TriangleAlert className="size-4 shrink-0" />
          ) : (
            <CircleCheck className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 break-words">{status.text}</span>
          {status.path !== undefined && dirName(status.path) !== '' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.api.openPath(dirName(status.path ?? ''))}
            >
              <FolderOpen />
              打开所在目录
            </Button>
          ) : null}
          {status.action ? (
            <Button variant="outline" size="sm" onClick={status.action.run}>
              {status.action.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setStatus(null)}
            aria-label="关闭这条提示"
            title="关闭这条提示"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>渠道列表</CardTitle>
          <CardDescription className="flex items-center gap-2">
            {loading ? (
              <>
                <Spinner />
                <span role="status">正在读取这个分组的渠道列表…</span>
              </>
            ) : (
              '渠道必填、别名选填。保存写的是整份列表，与搜索无关。'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* 空白示例原来挤在「按模板生成」旁边，只能靠 hover 才分得清两个按钮 —— 挪到它真正有用的地方 */}
          {rows.length === 0 && !loading ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">
                列表是空的。可以从一份空白示例起步：导出后照着改，再用「导入 JSON」读回来。
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportSampleJson}
                disabled={saving || loading}
              >
                <FileDown />
                导出一份空白示例
              </Button>
            </div>
          ) : null}
          {loading ? (
            /* 读磁盘时先把表的骨架画出来，别让一整块空白杵在那儿 */
            <div className="flex flex-col gap-2" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
                  <div className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
                  <div className="h-9 flex-1 animate-pulse rounded-md bg-muted" />
                  <div className="h-9 w-24 shrink-0 animate-pulse rounded-md bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <PairListEditor
              rows={rows}
              onChange={handleChange}
              keyLabel="渠道名"
              keyPlaceholder="例如 sample_gf"
              aliasPlaceholder="例如 官方"
              emptyHint="还没有渠道条目。可手工添加，或用上面的「按模板生成」。"
              selectable
              filterable
              duplicates={duplicates}
              errorRowIds={errorRowIds}
              resetFilterToken={filterResetToken}
            />
          )}
        </CardContent>
      </Card>

      <ChannelListPreviewDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title="导入渠道 JSON"
        preview={pending}
        currentCount={rows.length}
        mode={importMode}
        onModeChange={setImportMode}
        onConfirm={handleConfirmImport}
      />

      <ConfirmDialog
        open={confirmTemplate}
        onOpenChange={setConfirmTemplate}
        title="按模板生成？"
        description={`会按前缀「${prefix.trim() || '（空）'}」重算一份列表：共 ${templatePreview.total} 条${
          templatePreview.sample.length > 0
            ? `，例如 ${templatePreview.sample.join('、')}${
                templatePreview.total > templatePreview.sample.length ? '…' : ''
              }`
            : ''
        }。现在这 ${rows.length} 条会被替换掉，生成后可以用状态栏上的「撤销生成」退回来。`}
        warning={dirty ? '列表里有未保存的改动，覆盖后将丢失。' : undefined}
        confirmText="覆盖生成"
        onConfirm={() => {
          setConfirmTemplate(false)
          applyTemplate()
        }}
      />

      <ConfirmDialog
        open={confirmSwitch !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmSwitch(null)
          }
        }}
        title="换分组？"
        description={`「${selected?.name ?? ''}」里有 ${rows.length} 条还没保存的改动，换成别的分组就会丢掉。`}
        warning="想留下就先取消，再点「保存渠道列表」。"
        confirmText="放弃改动并切换"
        cancelText="留下继续编辑"
        destructive
        onConfirm={() => {
          const target = confirmSwitch
          setConfirmSwitch(null)
          if (target) {
            setSelectedId(target)
          }
        }}
      />

      {groupDialogs}
    </div>
  )
}
