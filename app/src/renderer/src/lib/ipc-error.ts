/**
 * 主进程 handler 抛出的错误，渲染层拿到的是
 * `Error invoking remote method '<通道名>': Error: <真正的原因>`。
 * 直接显示会把通道名当成问题本身，这里剥掉外层只留原因。
 */
export function ipcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/.exec(raw)
  const reason = (match ? match[1] : raw).trim()
  return reason || '未知错误'
}
