/**
 * 取出路径所在的目录，用来把「导出的那个文件」变成可以交给 `shell.openPath` 的目录。
 *
 * 渲染层拿不到 node 的 path 模块，而这里只需要「去掉最后一段」：
 * `\` 与 `/` 都当分隔符认，末尾多余的斜杠先去掉。
 * 没有分隔符时返回空串，调用方据此不显示「打开所在目录」。
 */
export function dirName(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (cut < 0) {
    return ''
  }
  // `C:\a.zip` 这种只剩盘符的情况要补回反斜杠，否则 openPath 收到的是「C:」
  if (cut === 2 && trimmed[1] === ':') {
    return `${trimmed.slice(0, 2)}\\`
  }
  return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut)
}
