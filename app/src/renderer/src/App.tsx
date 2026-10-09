import { TriangleAlert } from 'lucide-react'
import { Toaster } from 'sonner'
import { CopyDiagnosticsButton } from '@/components/CopyDiagnosticsButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import RuntimeBanner from '@/components/RuntimeBanner'
import StoreProblemBanner from '@/components/StoreProblemBanner'
import { AppSidebar, viewTitle, type AppView } from '@/components/AppSidebar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ChannelsScreen } from '@/screens/ChannelsScreen'
import { JksScreen } from '@/screens/JksScreen'
import { PackScreen } from '@/screens/PackScreen'
import { TemplateScreen } from '@/screens/TemplateScreen'
import { AppStoreProvider, useAppStore } from '@/store/app-store'
import { NavProvider, useNav } from '@/store/nav'
import { ThemeProvider } from '@/store/theme'

function CurrentView({ view }: { view: AppView }) {
  switch (view) {
    case 'pack':
      return <PackScreen />
    case 'jks':
      return <JksScreen />
    case 'channels':
      return <ChannelsScreen />
    case 'template':
      return <TemplateScreen />
  }
}

function Shell() {
  const { view, go: setView } = useNav()
  const store = useAppStore()

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        active={view}
        onSelect={setView}
        dataDir={store.dataDir}
        jksCount={store.jksItems.length}
        groupCount={store.groups.length}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b bg-background/50 px-6 backdrop-blur">
          <h1 className="text-base font-semibold">{viewTitle(view)}</h1>
          <div className="ml-auto flex items-center gap-2" id="topbar-status" />
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
            <RuntimeBanner />

            {store.loadError ? (
              <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <span className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  读取本地配置失败：{store.loadError}
                </span>
                {/*
                 * 原来只有这一句红字，没有出口 —— 读到坏文件是能靠重试恢复的
                 * （下次读就跳过了），可人只能关掉重开整个程序。
                 */}
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => void store.reload()}
                  >
                    重试读取
                  </Button>
                  <CopyDiagnosticsButton text={`读取本地配置失败：${store.loadError}`} />
                  {store.dataDir ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void window.api.openPath(store.dataDir)}
                    >
                      打开数据目录
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {store.usedFallback ? (
              <div className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                <span className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  程序目录不可写，数据已改存到用户目录，换个位置时数据不会跟着走。
                </span>
                {store.dataDir ? (
                  <div className="flex flex-wrap items-center gap-2 pl-6">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => void window.api.openPath(store.dataDir)}
                    >
                      打开数据目录
                    </Button>
                    <CopyDiagnosticsButton text={store.dataDir} />
                  </div>
                ) : null}
              </div>
            ) : null}

            <StoreProblemBanner />

            {store.loading && !store.initialized ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner />
                正在读取本地配置…
              </p>
            ) : (
              <CurrentView view={view} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppStoreProvider>
          <NavProvider>
            <Shell />
          </NavProvider>
        </AppStoreProvider>
      </ThemeProvider>
      {/*
       * 提示条挂在最外层：出包完成、复制成功这类事情发生在页面里，但提示要能
       * 跨页存活 —— 任务在后台跑完时用户可能已经切到别的页了。
       */}
      <Toaster position="bottom-right" richColors closeButton />
    </ErrorBoundary>
  )
}
