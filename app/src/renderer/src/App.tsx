import { TriangleAlert } from 'lucide-react'
import RuntimeBanner from '@/components/RuntimeBanner'
import StoreProblemBanner from '@/components/StoreProblemBanner'
import { AppSidebar, viewTitle, type AppView } from '@/components/AppSidebar'
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
        <header className="sticky top-0 z-10 flex h-[var(--topbar-height)] shrink-0 items-center border-b bg-background/50 px-6 backdrop-blur">
          <h1 className="text-sm font-medium">{viewTitle(view)}</h1>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
            <RuntimeBanner />

            {store.loadError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>读取本地配置失败：{store.loadError}</span>
              </div>
            ) : null}

            {store.usedFallback ? (
              <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>程序目录不可写，数据已改存到用户目录，换个位置时数据不会跟着走。</span>
              </div>
            ) : null}

            <StoreProblemBanner />

            {store.loading && !store.initialized ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
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
    <ThemeProvider>
      <AppStoreProvider>
        <NavProvider>
          <Shell />
        </NavProvider>
      </AppStoreProvider>
    </ThemeProvider>
  )
}
