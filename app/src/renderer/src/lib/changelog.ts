/**
 * 更新日志的解析。
 *
 * 源文件是 app/CHANGELOG.md，由每次发版的发布说明汇总而成，格式固定：
 *
 * ```
 * ## 0.3.5 - 2026-10-14
 *
 * ### 修复
 *
 * - 第一条
 * - 第二条
 * ```
 *
 * 这里只做「切成版本 + 分类 + 条目」这一件事，不碰渲染 —— 界面那边要按这个结构
 * 排版，测试也只需要对着结构断言。
 */

export interface ChangelogSection {
  /** 分类标题（修复 / 新增 / 优化…）。为空表示这段没有小标题，直接是条目 */
  title: string
  items: string[]
}

export interface ChangelogEntry {
  version: string
  /** `yyyy-MM-dd` */
  date: string
  sections: ChangelogSection[]
}

/** 去掉 `**粗体**` 的星号。条目里的强调靠排版承担，正文不该露出 markdown 标记 */
function stripBold(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').trim()
}

/** `## 0.3.5 - 2026-10-14`；日期与版本之间允许短横、长短横或波浪号 */
const VERSION_LINE = /^##\s+(\S+)\s*[-–—~]\s*(\S+)\s*$/
/** `### 修复` */
const SECTION_LINE = /^###\s+(.+)$/
/** `- 一条` 或 `* 一条` */
const ITEM_LINE = /^[-*]\s+(.+)$/

export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null
  let section: ChangelogSection | null = null

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      continue
    }

    const versionMatch = VERSION_LINE.exec(line)
    if (versionMatch) {
      current = { version: versionMatch[1], date: versionMatch[2], sections: [] }
      entries.push(current)
      section = null
      continue
    }

    // 文件开头的说明（`# 更新日志` 与那几行注解）落在第一个版本之前，直接跳过
    if (current === null) {
      continue
    }

    const sectionMatch = SECTION_LINE.exec(line)
    if (sectionMatch) {
      section = { title: sectionMatch[1].trim(), items: [] }
      current.sections.push(section)
      continue
    }

    const itemMatch = ITEM_LINE.exec(line)
    if (itemMatch) {
      if (section === null) {
        section = { title: '', items: [] }
        current.sections.push(section)
      }
      section.items.push(stripBold(itemMatch[1]))
      continue
    }

    /*
     * 走到这里说明是一条条目的续行 —— 条目在源文件里被折成了多行。
     * 接到上一条末尾而不是丢掉：丢了的话正文会缺半句，而且很难发现。
     */
    if (section !== null && section.items.length > 0) {
      const last = section.items.length - 1
      section.items[last] = `${section.items[last]}${stripBold(line)}`
    }
  }

  return entries
}
