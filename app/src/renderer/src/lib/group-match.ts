import type { GroupItem } from '@shared/types/store'

/**
 * 取文件名的「主干」：去掉目录，再去掉 .apk 扩展名。
 *
 * 分组名通常就是应用名，而用户手上的包叫 `示例应用.apk` 或 `示例应用_v1.2.3.apk` ——
 * 要拿文件名去比，整条路径比不中。
 */
export function fileStem(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return base.replace(/\.apk$/i, '')
}

/**
 * 拿这个 APK 的几个「身份」去碰撞分组名，撞上就返回那个分组。
 *
 * 候选按可信度从高到低排（应用名 → 文件名 → 包名），任何一个撞上就算；
 * 都撞上时取**名字最长**的那个 —— 名字越长越具体，
 * 「示例应用」和「示例应用极速版」同时命中时，该选后者。
 *
 * 为什么用「包含」而不是全等：文件名里常带版本号与构建号（`示例应用_v1.2.3.apk`），
 * 全等比不中，而用户显然是想用这个分组。包名用包含也成立，它本身就是个长串。
 *
 * 一个都没撞上返回 undefined：调用方保持当前分组不动，
 * 也就是这个签名身份上次用的那个。
 */
export function matchGroupByApk(candidates: string[], groups: GroupItem[]): GroupItem | undefined {
  let best: GroupItem | undefined
  let bestLength = 0

  for (const raw of candidates) {
    const needle = raw.trim().toLowerCase()
    if (needle === '') {
      continue
    }
    for (const group of groups) {
      const name = group.name.trim().toLowerCase()
      if (name === '' || !needle.includes(name)) {
        continue
      }
      if (name.length > bestLength) {
        best = group
        bestLength = name.length
      }
    }
  }
  return best
}
