/**
 * 稳定 id 的分配规则。jks 与分组共用 —— 两者的 id 都会变成 data/ 下的文件名，
 * 撞名就等于互相覆盖，所以规则必须只有一处。
 */

/** 同 id 已被占用时退到 <id>_2、<id>_3…，绝不覆盖已有条目 */
export function allocateId(baseId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(baseId)) {
    return baseId
  }
  let index = 2
  while (taken.has(`${baseId}_${index}`)) {
    index += 1
  }
  return `${baseId}_${index}`
}

/**
 * 把用户填的字段变成能当文件名用的 id。
 * 签名文件有源文件名可借，分组没有 —— 只能从分组名推导，
 * 所以这里要挡住路径分隔符与 Windows 保留字符。
 */
export function toFileId(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^\.+/, '')
  return cleaned === '' ? fallback : cleaned
}
