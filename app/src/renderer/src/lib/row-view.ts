import type { PairRow } from '@/components/PairListEditor'

/**
 * 列表的排序方式。'none' 表示保持用户手里原来的行序 ——
 * 排序只用于看，不重排 rows 本身，免得保存时把文件里的顺序也改了。
 */
export type RowSort = 'none' | 'key' | 'alias'

/**
 * 中文别名按拼音排、渠道名里的数字按大小排（t_2 在 t_10 前面），
 * 忽略大小写。Collator 建一次就够，别每行都 new。
 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

function compareByKey(left: PairRow, right: PairRow): number {
  const byKey = collator.compare(left.key.trim(), right.key.trim())
  return byKey !== 0 ? byKey : collator.compare(left.alias.trim(), right.alias.trim())
}

function compareByAlias(left: PairRow, right: PairRow): number {
  const leftAlias = left.alias.trim()
  const rightAlias = right.alias.trim()

  // 别名是选填的，空值统一沉到末尾 —— 否则一屏里全是空行，排好序的那半截反而看不见
  if (leftAlias === '' && rightAlias === '') {
    return compareByKey(left, right)
  }
  if (leftAlias === '') {
    return 1
  }
  if (rightAlias === '') {
    return -1
  }

  const byAlias = collator.compare(leftAlias, rightAlias)
  return byAlias !== 0 ? byAlias : compareByKey(left, right)
}

/**
 * 算出列表当前该显示哪些行、按什么顺序显示。
 * 纯显示层：返回的是新数组，调用方的 rows 一个字节都不动。
 */
export function viewPairRows(rows: PairRow[], query: string, sort: RowSort): PairRow[] {
  const needle = query.trim().toLowerCase()
  const matched =
    needle === ''
      ? rows
      : rows.filter(
          (row) =>
            row.key.toLowerCase().includes(needle) || row.alias.toLowerCase().includes(needle),
        )

  if (sort === 'none') {
    return matched
  }

  const ordered = [...matched]
  ordered.sort(sort === 'alias' ? compareByAlias : compareByKey)
  return ordered
}
