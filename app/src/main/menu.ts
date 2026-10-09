import { app, Menu, type MenuItemConstructorOptions } from 'electron'

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
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
