import type { ChannelImportMode } from '@shared/types/pack'
import type { PairRow } from '@/components/PairListEditor'

export interface MergedImport {
  /** 合并后要放进编辑器的行 */
  rows: PairRow[]
  /** 追加模式下真正新增的条数 */
  added: number
  /** 追加模式下因为渠道名已存在而跳过的条数 */
  skipped: number
}

/** 渠道名比对用的键：忽略大小写与首尾空白，与保存时的查重口径一致 */
function keyOf(row: PairRow): string {
  return row.key.trim().toLowerCase()
}

/**
 * 把导入的条目合并进界面上的列表。
 *
 * 导入不再直接写文件，所以覆盖/追加只是「怎么改编辑器里的内容」：
 * - `overwrite` 整个换掉；
 * - `append` 接到现有条目后面，**渠道名已存在的跳过** ——
 *   同一个 jks 下同名渠道会互相覆盖，放进去只会让人以为多了一条。
 */
export function mergeImportedRows(
  existing: PairRow[],
  incoming: PairRow[],
  mode: ChannelImportMode,
): MergedImport {
  if (mode === 'overwrite') {
    return { rows: incoming, added: incoming.length, skipped: 0 }
  }

  const seen = new Set(existing.map(keyOf))
  const fresh: PairRow[] = []
  for (const row of incoming) {
    const key = keyOf(row)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    fresh.push(row)
  }
  return {
    rows: [...existing, ...fresh],
    added: fresh.length,
    skipped: incoming.length - fresh.length,
  }
}
