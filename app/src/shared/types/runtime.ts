/** 内置运行时清单里的一个组件 */
export interface RuntimeComponent {
  key: string
  label: string
  /** 绝对路径。打包后位于 resources/bin 下，开发态位于工程目录下 */
  path: string
  /** 存在且非空。0 字节按缺失处理 —— 下载被截断时就是这个样子 */
  exists: boolean
  sizeBytes: number
}

export interface RuntimeCheckResult {
  binDir: string
  components: RuntimeComponent[]
  /** 全部组件都就位 */
  ok: boolean
}
