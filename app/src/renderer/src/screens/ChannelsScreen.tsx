import { useEffect, useMemo, useState } from 'react'
import { FileDown, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
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
import { findDuplicates } from '@/lib/duplicates'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useAppStore } from '@/store/app-store'

/** 编辑器里的行 → 落盘/导出用的条目；别名为空时不写这个字段 */
function toChannelEntries(rows: PairRow[]): ChannelEntry[] {
  return rows.map((row) => {
    const alias = row.alias.trim()
    return alias ? { channel: row.key.trim(), alias } : { channel: row.key.trim() }
  })
}

export function ChannelsScreen() {
  const { groups, template, getChannels, saveChannels, saveGroup } = useAppStore()
  const [selectedId, setSelectedId] = useState('')
  const [rows, setRows] = useState<PairRow[]>([])
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prefix, setPrefix] = useState('')
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
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

  // 前缀默认取分组的英文名（写进包的那个标识），可直接改
  useEffect(() => {
    setPrefix(selected?.app ?? selectedId)
  }, [selected?.app, selectedId])

  const duplicates = useMemo(() => findDuplicates(rows.map((row) => row.key)), [rows])
  const hasEmpty = rows.some((row) => row.key.trim() === '')

  const handleChange = (next: PairRow[]) => {
    setRows(next)
    setDirty(true)
    setStatus(null)
  }

  const applyTemplate = () => {
    if (!selected) {
      return
    }
    const config = buildChannelsFromTemplate(template.suffixes, prefix, selected.app)
    setRows(config.channelInfoList.map((entry) => newPairRow(entry.channel, entry.alias ?? '')))
    setDirty(true)
    setStatus({
      kind: 'ok',
      text: `已按模板生成 ${config.channelInfoList.length} 条，尚未保存。`,
    })
  }

  /*
   * 按模板生成是整表替换。列表里还有没保存的改动时先问一声 ——
   * 那些改动只存在界面上，换掉就没了。
   */
  const handleApplyTemplateClick = () => {
    if (rows.length > 0 && dirty) {
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
      const result = await window.api.exportChannels(
        selected.id,
        selected.app,
        toChannelEntries(rows),
      )
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出 ${result.count ?? 0} 条渠道：${result.path}${
          dirty ? '（含尚未保存的修改）' : ''
        }。可直接用于批量写入渠道。`,
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
    try {
      const result = await window.api.previewChannels(selected.app)
      if (result === null) {
        return
      }
      setImportMode('overwrite')
      setPending(result)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
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
      const result = await window.api.exportSampleChannels(selected.id, selected.app, prefix)
      if (result.canceled) {
        return
      }
      setStatus({
        kind: 'ok',
        text: `已导出示例 ${result.count ?? 0} 条：${result.path}${
          result.fromTemplate ? '（条目取自「渠道模板」页的模板）' : '（模板为空，用的是内置兜底示例）'
        }。改好后用「导入 JSON」读回来。`,
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

  const handleSave = async () => {
    if (!selected) {
      return
    }
    if (hasEmpty) {
      // 空行可能正被搜索藏起来，先把筛选清掉再报错，免得用户找不到
      setFilterResetToken((value) => value + 1)
      setStatus({ kind: 'error', text: '渠道名不能为空，空行已经标红。' })
      return
    }
    if (duplicates.length > 0) {
      setFilterResetToken((value) => value + 1)
      setStatus({ kind: 'error', text: `渠道名重复：${duplicates.join('、')}。` })
      return
    }
    setSaving(true)
    try {
      await saveChannels(selected.id, {
        defaultExtraInfo: { app: selected.app },
        channelInfoList: toChannelEntries(rows),
      })
      setDirty(false)
      setStatus({ kind: 'ok', text: '渠道列表已保存。' })
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setSaving(false)
    }
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
        busy={groupBusy}
        onSubmit={handleSubmitGroup}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="删除分组？"
        description={`会删掉「${selected?.name ?? ''}」以及它名下的渠道列表。`}
        warning="渠道列表会一并删除，无法恢复。"
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
              一个分组代表一个应用：中文应用名只在本工具里显示，英文名会写进安装包。出包时选中哪个分组，就按哪个分组的渠道列表出包。
            </p>
            <p className="text-sm text-muted-foreground">
              签名文件只负责签名：需要重签名时才要用到，只写渠道时可以完全不选。
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
            <Button variant="outline" onClick={handleImportJson} disabled={saving || loading}>
              导入 JSON
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
              ? `英文名 ${selected.app}${
                  selected.appLabel ? `　中文应用名 ${selected.appLabel}` : ''
                }`
              : '请选择一个分组。'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="max-w-sm flex-1">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger aria-label="选择分组">
                  <SelectValue placeholder="请选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}（{item.app}）
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
            </div>
            <Button variant="outline" onClick={handleApplyTemplateClick}>
              <Wand2 />
              按模板生成
            </Button>
            <Button
              variant="outline"
              onClick={handleExportSampleJson}
              disabled={saving || loading || rows.length > 0}
              title={
                rows.length > 0
                  ? '列表里已经有渠道了，要拿走现有内容请用右上角的「导出 JSON」'
                  : '导出一份可编辑的示例 JSON'
              }
            >
              <FileDown />
              导出示例 JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            生成规则：渠道名 = 前缀 + &quot;_&quot; + 后缀。生成的是独立副本，之后再改模板也不会影响这里。
            列表里还有未保存的改动时，会先确认再覆盖。
          </p>
          <p className="text-xs text-muted-foreground">
            「导出示例 JSON」只在渠道列表为空时可用，导出的是一份可编辑的起点（条目取自「渠道模板」页的模板）；
            改好后用右上角的「导入 JSON」读回来。
          </p>
          <p className="text-xs text-muted-foreground">
            「导入 JSON」会把文件里的条目读进一个预览框，可以在里面直接增删改；确认后只填进下面的列表，
            点「保存渠道列表」才落盘。
          </p>
        </CardContent>
      </Card>

      {status ? (
        <p
          className={
            status.kind === 'error'
              ? 'text-sm text-destructive'
              : status.kind === 'ok'
                ? 'text-sm text-success'
                : 'text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>渠道列表</CardTitle>
          <CardDescription>
            渠道必填、别名选填。保存写的是整份列表，与搜索无关。
            {loading ? ' 读取中…' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PairListEditor
            rows={rows}
            onChange={handleChange}
            keyLabel="渠道名"
            keyPlaceholder="例如 sample_gf"
            aliasPlaceholder="例如 官方"
            emptyHint="还没有渠道条目。可手工添加，或用上面的「按模板生成」。"
            selectable
            filterable
            resetFilterToken={filterResetToken}
          />
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
        description={`会按当前前缀「${prefix.trim() || '（空）'}」重算一份列表，替换掉现有的 ${rows.length} 条。`}
        warning="列表里有未保存的改动，覆盖后将丢失。"
        confirmText="覆盖生成"
        onConfirm={() => {
          setConfirmTemplate(false)
          applyTemplate()
        }}
      />

      {groupDialogs}
    </div>
  )
}
