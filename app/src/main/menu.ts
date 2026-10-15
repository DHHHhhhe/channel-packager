import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/channels'
import { getDataDir, isInstalledLayout } from './paths'
import { checkForUpdates } from './updater'
import type { NavCommand } from '../shared/types/api'

/**
 * 页面菜单项：把键位写在菜单上，别人才知道有快捷键。
 *
 * registerAccelerator: false 是关键 —— 按键本身由渲染层的全局按键处理
 * （见 store/nav.tsx），这里只负责**显示**键位，并给鼠标用户一个入口。
 * 交给系统注册的话，按 Ctrl+1 会被菜单截走，界面里那套反而不触发。
 */
function navItem(
  label: string,
  accelerator: string,
  command: NavCommand,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: (_item, target) => {
      // 第二参在类型上是 BaseWindow（可能不是窗口，也可能已经关了），要收窄
      if (target instanceof BrowserWindow) {
        target.webContents.send(IPC_CHANNELS.navCommand, command)
      }
    },
  }
}

/**
 * 装一份中文应用菜单。
 *
 * 不装的话按 Alt 会弹出 Electron 自带的那份英文菜单，里面还带着「Toggle
 * Developer Tools」「Reload」—— 这是给运营用的出包工具，误点一下整个界面就重来，
 * 填了一半的表单、排好的队列全没了。所以菜单自己写：标签用中文，
 * 重新加载与开发者工具只在没打包时出现。
 */
export function installApplicationMenu(): void {
  const devItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { type: 'separator' },
        { role: 'reload', label: '重新加载界面' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ]

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        // 关窗口的快捷键留着：渲染层有未保存改动时会拦下来并提示，不会静默丢东西
        { role: 'close', label: '关闭窗口', accelerator: 'CmdOrCtrl+W' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '页面',
      submenu: [
        navItem('出包', 'CmdOrCtrl+1', 'pack'),
        navItem('签名配置', 'CmdOrCtrl+2', 'jks'),
        navItem('渠道配置', 'CmdOrCtrl+3', 'channels'),
        navItem('模板与配置包', 'CmdOrCtrl+4', 'template'),
        { type: 'separator' },
        navItem('保存当前页', 'CmdOrCtrl+S', 'save'),
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...devItems,
      ],
    },
    {
      label: '帮助',
      submenu: [
        /*
         * 只有安装版才摆这一项：不是安装包装出来的版本没有安装目录，
         * 自动更新没有可落脚的地方（见 updater.ts）。
         */
        ...(isInstalledLayout()
          ? [
              {
                label: '检查更新',
                click: (): void => {
                  void checkForUpdates(true)
                },
              } satisfies MenuItemConstructorOptions,
            ]
          : []),
        {
          label: '打开数据目录',
          click: (): void => {
            // openPath 失败时返回的是错误字符串、不抛异常；菜单里没有更合适的反馈出口，
            // 打不开就是没反应 —— 路径本身在排障提示旁边有「复制诊断信息」可拿
            void shell.openPath(getDataDir())
          },
        },
        {
          label: `版本 ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
