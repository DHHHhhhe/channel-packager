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
!macroend
