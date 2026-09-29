import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 挂载点，index.html 与 main.tsx 不匹配')
}

/*
 * 把文件拖到窗口空白处时，Electron 默认会直接导航过去，界面就变成文件预览、应用等于卡死。
 * 这里统一拦掉默认行为；真正接收拖拽的区域自己在处理函数里再 preventDefault。
 */
window.addEventListener('dragover', (event) => {
  event.preventDefault()
})
window.addEventListener('drop', (event) => {
  event.preventDefault()
})

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
