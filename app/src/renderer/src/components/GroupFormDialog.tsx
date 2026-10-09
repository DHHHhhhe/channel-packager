import { useEffect, useState } from 'react'
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
import type { GroupItem } from '@shared/types/store'

export interface GroupFormPayload {
  /** 分组名：渠道列表里显示的名字 */
  name: string
  /** 中文应用名：只给自己看，不写进包 */
  appLabel: string
  /** 英文名：写进 defaultExtraInfo.app，App 里按它取值 */
  app: string
}

interface GroupFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = 新建 */
  group: GroupItem | null
  busy?: boolean
  onSubmit: (payload: GroupFormPayload) => void
}

/**
 * 新建 / 编辑分组。
 *
 * 三个字段里只有「英文名」会写进包（`defaultExtraInfo.app`），中文应用名纯粹是给人看的，
 * 分组名是渠道列表里那一行的标题。新建时分组名跟着中文应用名走（没有中文名就跟着英文名），
 * 手动改过之后就不再自动覆盖 —— 见 Q4「分组名默认取应用名」。
 */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  busy = false,
  onSubmit,
}: GroupFormDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [appLabel, setAppLabel] = useState('')
  const [app, setApp] = useState('')
  /** 分组名被手动改过之后，就不再用应用名去覆盖它 */
  const [nameTouched, setNameTouched] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    setName(group?.name ?? '')
    setAppLabel(group?.appLabel ?? '')
    setApp(group?.app ?? '')
    // 编辑时名字是用户自己定的，不该被应用名重写
    setNameTouched(group !== null)
    setError('')
  }, [open, group])

  const resolvedName = nameTouched ? name : name.trim() === '' ? appLabel || app : name

  const handleSubmit = () => {
    const nextApp = app.trim()
    if (nextApp === '') {
      setError('英文名不能为空 —— 它会写进包的 defaultExtraInfo.app，App 里就按这个名字取值。')
      return
    }
    const nextName = resolvedName.trim()
    if (nextName === '') {
      setError('分组名不能为空 —— 渠道列表里要有个名字才认得出来。')
      return
    }
    setError('')
    onSubmit({ name: nextName, appLabel: appLabel.trim(), app: nextApp })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? '编辑分组' : '新建分组'}</DialogTitle>
          <DialogDescription>
            一个分组就是一份渠道列表的家，跟 jks 没关系 —— 没有 jks 也能建。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-name">分组名</Label>
            <Input
              id="group-name"
              value={resolvedName}
              onChange={(event) => {
                setNameTouched(true)
                setName(event.target.value)
              }}
              placeholder="例如 沐爱"
            />
            <p className="text-xs text-muted-foreground">
              只出现在这个工具里，渠道列表按它认。新建时默认跟着中文应用名走，可以改。
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-app-label">中文应用名</Label>
            <Input
              id="group-app-label"
              value={appLabel}
              onChange={(event) => setAppLabel(event.target.value)}
              placeholder="例如 沐爱"
            />
            <p className="text-xs text-muted-foreground">只给自己看，不会写进包。</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-app">英文名</Label>
            <Input
              id="group-app"
              value={app}
              onChange={(event) => setApp(event.target.value)}
              placeholder="例如 demo"
            />
            <p className="text-xs text-muted-foreground">
              会写进包的 <code>defaultExtraInfo.app</code>，App 里用
              <code> WalleChannelReader.get(context, &quot;app&quot;) </code>
              取值，所以要用代码认得的英文标识。分组 id 也从它来，决定了渠道文件名。
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? '保存中…' : group ? '保存' : '新建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
