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
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="主题"
      className="flex items-center gap-0.5 rounded-lg border border-sidebar-border p-0.5"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon
        const active = option.value === theme
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="icon-xs"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
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
