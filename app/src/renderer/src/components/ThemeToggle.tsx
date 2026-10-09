import { useRef } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTheme } from '@/store/theme'

const OPTIONS = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
] as const

/**
 * 主题档位切换。三档并排而不是一个开关 ——
 * 「跟随系统」是第三种状态，用开关表达不了，也没法从开关的外观看出现在是哪一档。
 *
 * 三个按钮都是纯图标，所以按 radiogroup 的规矩来：方向键换档、只有当前档进
 * Tab 序列（roving tabindex）。否则键盘用户得按三次 Tab 才能越过它。
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const move = (delta: number): void => {
    const current = OPTIONS.findIndex((option) => option.value === theme)
    const index = (current + delta + OPTIONS.length) % OPTIONS.length
    void setTheme(OPTIONS[index].value)
    buttons.current[index]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className="flex items-center gap-0.5 rounded-lg border border-sidebar-border p-0.5"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {OPTIONS.map((option, index) => {
        const Icon = option.icon
        const active = option.value === theme
        return (
          <Button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            variant="ghost"
            size="icon-xs"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            tabIndex={active ? 0 : -1}
            onClick={() => void setTheme(option.value)}
            className={cn(
              'text-muted-foreground',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            <Icon />
          </Button>
        )
      })}
    </div>
  )
}
