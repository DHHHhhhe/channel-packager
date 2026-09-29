/** 找出重复出现的值（忽略大小写与首尾空白），用于渠道名/后缀的去重校验 */
export function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicated.add(value.trim())
    }
    seen.add(key)
  }
  return [...duplicated]
}
