import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ThemeChoice } from '@shared/types/settings'
import { applyThemeClass, prefersDark, watchTheme } from '@/lib/theme'

/*
 * 主题档位（跟随系统 / 浅色 / 深色）放在 context 里。
 *
 * 档位本身只用来点亮切换控件 —— 界面深浅由 `<html class="dark">` 决定，
 * 而那个类跟的是主进程 nativeTheme 的结果（见 lib/theme.ts）。
 * 两处真源会打架，所以这里绝不自己算「深色还是浅色」。
 */
interface ThemeValue {
  /** 用户选的档位，不是当前显示出来的深浅 */
  theme: ThemeChoice
  setTheme: (choice: ThemeChoice) => Promise<void>
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setChoice] = useState<ThemeChoice>(() => window.api.initialTheme)

  // 档位一变就重新对一次：主进程刚改完 themeSource，媒体查询跟着变，
  // 但它到渲染层是异步的，所以既等事件、也在改完后主动补一次。
  useEffect(() => {
    const sync = (): void => applyThemeClass(prefersDark())
    sync()
    return watchTheme(sync)
  }, [theme])

  const setTheme = useCallback(async (choice: ThemeChoice): Promise<void> => {
    setChoice(choice)
    await window.api.setTheme(choice)
    applyThemeClass(prefersDark())
    // 媒体查询的更新可能落在下一帧，再补一次兜底
    window.requestAnimationFrame(() => applyThemeClass(prefersDark()))
  }, [])

  const value = useMemo<ThemeValue>(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme 必须在 ThemeProvider 内使用')
  }
  return value
}
