import { useState } from 'react'
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { JksFormDialog } from '@/components/JksFormDialog'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { JksItem } from '@shared/types/store'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { Spinner } from '@/components/ui/spinner'
import { useAppStore } from '@/store/app-store'

export function JksScreen() {
  const { jksItems, saveJks, refreshJks, syncJks } = useAppStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<JksItem | undefined>(undefined)
  const [deleting, setDeleting] = useState<JksItem | undefined>(undefined)
  const [syncing, setSyncing] = useState<JksItem | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  /*
   * warning 是「没出错，但需要你决定」的状态（原文件变了）。
   * syncId 记着这条提示对应哪个条目，好把「刷新副本」按钮直接放在提示里 ——
   * 否则用户还得回表格里找是哪一行。
   */
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error' | 'warning'
    text: string
    syncId?: string
  } | null>(null)

  const openAdd = () => {
    setEditing(undefined)
    setDialogOpen(true)
  }

  const openEdit = (item: JksItem) => {
    setEditing(item)
    setDialogOpen(true)
  }

  /*
   * 比对。原文件变了只是「有件事要你决定」，不是出错 —— 之前用红色报错，
   * 用户看到的第一反应是「我搞坏了什么」，其实什么都没坏，只是副本旧了。
   */
  const handleRefresh = async (item: JksItem) => {
    setStatus(null)
    try {
      const result = await refreshJks(item.id)
      if (result.status === 'unchanged') {
        setStatus({ kind: 'ok', text: `${item.displayName}：原文件与本工具内的副本一致，无需处理。` })
      } else if (result.status === 'changed') {
        setStatus({
          kind: 'warning',
          text: `${item.displayName}：原文件已变化（SHA256 ${result.sourceSha256?.slice(0, 8)}），本工具内还是旧的那份。`,
          syncId: item.id,
        })
      } else {
        setStatus({
          kind: 'warning',
          text: `${item.displayName}：${result.message ?? '原文件不可访问。'}`,
        })
      }
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    }
  }

  /*
   * 用原文件覆盖副本。
   *
   * 签名文件一旦换掉，之后出的包签名就跟以前不一样 —— 应用市场那边是按签名认应用的，
   * 所以这一步必须让用户明确点一下，不能在「比对发现变了」之后顺手替他做了。
   */
  const handleSync = async () => {
    if (!syncing) {
      return
    }
    const target = syncing
    setBusy(true)
    try {
      const result = await syncJks(target.id)
      if (result.status === 'synced') {
        setStatus({
          kind: 'ok',
          text: `已用原文件刷新 ${target.displayName} 的副本（SHA256 ${result.sourceSha256?.slice(0, 8)}），显示名、别名与密码都保留。`,
        })
      } else if (result.status === 'unchanged') {
        setStatus({ kind: 'ok', text: `${target.displayName}：原文件与副本本来就一致，没有改动。` })
      } else {
        setStatus({
          kind: 'warning',
          text: `${target.displayName}：${result.message ?? '原文件不可访问。'}`,
        })
      }
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      // 失败也把确认框关掉：状态提示在对话框后面，不关就看不见
      setBusy(false)
      setSyncing(undefined)
    }
  }

  const handleDelete = async () => {
    if (!deleting) {
      return
    }
    setBusy(true)
    try {
      await saveJks({ action: 'remove', id: deleting.id })
      setStatus({
        kind: 'ok',
        text: `已删除 ${deleting.displayName}，本工具内的副本已清除。分组与渠道列表不受影响。`,
      })
      setDeleting(undefined)
    } catch (error) {
      setStatus({ kind: 'error', text: ipcErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  // 提示里那个「刷新副本」按钮要认得出是哪一条；单独取出来，闭包里就不用再判空
  const statusSyncId = status?.syncId

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="每个签名文件只保存签名要用的别名与密码。签名与校验只使用本工具内的副本。"
        actions={
          <Button onClick={openAdd}>
            <Plus />
            新增签名文件
          </Button>
        }
      />

      {status ? (
        <div
          role="status"
          aria-live="polite"
          className={
            status.kind === 'error'
              ? 'flex flex-wrap items-center gap-2 text-sm text-destructive'
              : status.kind === 'warning'
                ? 'flex flex-wrap items-center gap-2 text-sm text-warning'
                : 'flex flex-wrap items-center gap-2 text-sm text-success'
          }
        >
          {status.kind === 'warning' ? <AlertTriangle className="size-4 shrink-0" /> : null}
          <span>{status.text}</span>
          {statusSyncId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const item = jksItems.find((entry) => entry.id === statusSyncId)
                if (item) {
                  setSyncing(item)
                }
              }}
            >
              <RefreshCw />
              刷新副本
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>已配置的签名文件</CardTitle>
          <CardDescription>共 {jksItems.length} 个</CardDescription>
        </CardHeader>
        <CardContent>
          {jksItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有签名文件。点右上角「新增签名文件」选择文件，别名与密码会按文件名自动带出。
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>显示名</TableHead>
                    <TableHead>别名</TableHead>
                    <TableHead>来源路径</TableHead>
                    <TableHead>SHA256</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jksItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.displayName}</span>
                          <Badge variant="outline">
                            {item.credentialSource === 'derived' ? '推导' : '手工'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">{item.id}</div>
                      </TableCell>
                      <TableCell>{item.alias}</TableCell>
                      <TableCell className="max-w-[16rem] truncate" title={item.sourcePath}>
                        {item.sourcePath}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.sha256.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(item)}
                            title="编辑"
                            aria-label={`编辑 ${item.displayName}`}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRefresh(item)}
                            title="从原文件重新导入（只比对，不自动同步）"
                            aria-label={`比对 ${item.displayName} 的原文件`}
                          >
                            <RefreshCw />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleting(item)}
                            title="删除"
                            aria-label={`删除 ${item.displayName}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <JksFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
        onFinished={(message) => setStatus({ kind: 'ok', text: message })}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => (open ? undefined : setDeleting(undefined))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除 {deleting?.displayName}</DialogTitle>
            <DialogDescription>
              只会删除本工具内的副本，无法撤销。分组与渠道列表不受影响，原文件也不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>
              {busy ? <Spinner /> : null}
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(syncing)}
        onOpenChange={(open) => (open ? undefined : setSyncing(undefined))}
        title={`用原文件刷新 ${syncing?.displayName ?? ''} 的副本？`}
        description="会用原文件当前的内容覆盖本工具内的副本，显示名、别名与密码都保留。"
        warning="签名身份会跟着变。之后用这个文件出的包，签名与之前不同，应用市场可能不认。"
        confirmText="确认刷新"
        destructive
        onConfirm={handleSync}
      />
    </div>
  )
}
