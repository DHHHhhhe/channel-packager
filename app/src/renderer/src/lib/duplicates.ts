/** 一组重复的值：值本身 + 它出现过的行号（0 起，按传入顺序） */
export interface DuplicateGroup {
  value: string
  indices: number[]
}

/**
 * 找出重复出现的值（忽略大小写与首尾空白），并带上每一处出现的行号。
 *
 * 只报「哪两条重名」不够用：几百行的列表里，用户还得自己去找那两行。
 * 行号让调用方能直接把人带过去，也能在文案里写清「第 12 行与第 187 行」。
 */
export function findDuplicateGroups(values: readonly string[]): DuplicateGroup[] {
  const firstSeen = new Map<string, number>()
  const groups = new Map<string, DuplicateGroup>()

  values.forEach((value, index) => {
    const key = value.trim().toLowerCase()
    if (!key) {
      return
    }
    const seen = firstSeen.get(key)
    if (seen === undefined) {
      firstSeen.set(key, index)
      return
    }
    const group = groups.get(key)
    if (group) {
      group.indices.push(index)
      return
    }
    groups.set(key, { value: value.trim(), indices: [seen, index] })
  })

  return [...groups.values()]
}

/** 只要重复的值本身，不要行号 */
export function findDuplicates(values: readonly string[]): string[] {
  return findDuplicateGroups(values).map((group) => group.value)
}
