; electron-builder 的 NSIS 模板会在装完文件之后调用这里定义的宏。
;
; 这里只做一件事：在安装目录里放一个标记文件，让应用知道自己是「安装版」，
; 而不是便携版或解压即用版 —— 三种形态的数据目录规则不一样（见 src/main/paths.ts）：
;
;   安装版       %LOCALAPPDATA%\渠道分包工具\data（在安装目录之外，卸载不会连数据一起删）
;   便携版/解压版 exe 旁边的 data\（跟着文件夹走，拷到哪儿数据就在哪儿）
;
; 只认「安装目录里有没有这个文件」，不靠猜路径 —— 有人把解压出来的文件夹放到
; Program Files 下面也不该被当成安装版。

!macro customInstall
  FileOpen $0 "$INSTDIR\.installed" w
  FileWrite $0 "1"
  FileClose $0

  ; 通知资源管理器刷新图标缓存。
  ;
  ; 桌面与开始菜单的快捷方式图标是从 exe 里读的，而安装过程把旧 exe 删掉换成了新的。
  ; 资源管理器不会重新读文件，它拿缓存的图标去匹配，新 exe 对不上旧缓存 ——
  ; 结果就是快捷方式变成一片空白，看起来像程序坏了（微软官方文档里
  ; "application-shortcuts-show-blank-icons" 说的就是这个）。
  ;
  ; 两条通知缺一不可：
  ;   1) 对被替换的这个 exe 精确通知（SHCNE_UPDATEITEM | SHCNF_PATHW）
  ;      只发目录级的 SHCNE_UPDATEDIR 是不够的：系统不会去遍历哪个文件变了，多数情况没反应
  ;   2) 再全局刷新一次，把文件系统元数据、资源管理器内存、系统图标数据库
  ;      这三层缓存一起清掉。
  ;      微软文档要求 SHCNE_ASSOCCHANGED 必须带 SHCNF_IDLIST，而 SHCNF_FLUSH
  ;      只是修饰位、不能单独用 —— 两个相或就是 0x1000（IDLIST 本身是 0）。
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x0005, w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", i 0)'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend
