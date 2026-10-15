import fs from 'node:fs'
import zlib from 'node:zlib'
import type { ApkManifest } from '../shared/types/apk'

/*
 * 为什么自己解析而不是装个包：
 *
 * 这个工具承诺「不用装 Java、不用配 Android SDK」，所以不能用 aapt；现成的 npm 包
 * 要么带 node-forge 这类用不上的依赖，要么只面向浏览器。APK 的清单就是 ZIP 里的一个
 * 二进制 XML，格式是公开且稳定的，下面按字节读一遍比多一个依赖更划算。
 *
 * 格式依据：PKWARE 的 APPNOTE（ZIP）、Androguard 的 AXML 说明（二进制 XML）。
 * 每一段布局都写在对应函数上方，改之前先对一遍。
 */

// ── ZIP ──────────────────────────────────────────────────────────────────────
// 结构：local file header + data 反复出现，最后是 central directory 与 EOCD。
// 走 central directory 而不是顺序扫 local header：用了数据描述符（标志位 bit 3）时
// local header 里的压缩大小是 0，只有 central directory 那份才准。

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** EOCD 定长 22 字节，后面最多再跟 65535 字节注释 —— 往回找的范围 */
const MAX_EOCD_SEARCH = 22 + 0xffff

/**
 * 从尾部往前找 EOCD。
 *
 * 不能直接取最后 22 字节：ZIP 允许在 EOCD 后面挂一段注释，长度不定。
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - MAX_EOCD_SEARCH)
  for (let at = buf.length - 22; at >= lowest; at -= 1) {
    if (buf.readUInt32LE(at) === EOCD_SIGNATURE) {
      return at
    }
  }
  return -1
}

/** 按中央目录里的记录取出某个条目的原始（解压后）内容；没有这个条目返回 null */
function readZipEntry(buf: Buffer, wantName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buf)
  if (eocd < 0) {
    return null
  }
  // EOCD: +8 本盘记录数 / +10 总记录数 / +12 中央目录大小 / +16 中央目录偏移
  const count = buf.readUInt16LE(eocd + 10)
  let cursor = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      return null
    }
    // 中央目录记录：+10 压缩方法 / +20 压缩后大小 / +28 文件名长 / +30 扩展字段长
    //               / +32 注释长 / +42 对应 local header 的偏移 / +46 文件名
    const method = buf.readUInt16LE(cursor + 10)
    const compressedSize = buf.readUInt32LE(cursor + 20)
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const localOffset = buf.readUInt32LE(cursor + 42)
    const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    if (name === wantName) {
      return inflateLocal(buf, localOffset, method, compressedSize)
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return null
}

/**
 * local file header 布局（与 central directory 不同，别混用）：
 *   +0 签名 / +8 压缩方法 / +18 压缩后大小 / +26 文件名长 / +28 扩展字段长
 *   +30 起是文件名、扩展字段，之后才是数据。
 *
 * 大小以 central directory 那份为准，所以这里的 compressedSize 是传进来的。
 */
function inflateLocal(
  buf: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
): Buffer | null {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    return null
  }
  const nameLength = buf.readUInt16LE(localOffset + 26)
  const extraLength = buf.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLength + extraLength
  if (start + compressedSize > buf.length) {
    return null
  }

  const raw = buf.subarray(start, start + compressedSize)
  if (method === 0) {
    return raw
  }
  if (method === 8) {
    try {
      return zlib.inflateRawSync(raw)
    } catch {
      return null
    }
  }
  return null
}

// ── 二进制 XML（AXML）─────────────────────────────────────────────────────────
// 一串首尾相接的 chunk，每个 chunk 开头 8 字节相同：
//   +0 类型（uint16）/ +2 头部长度（uint16）/ +4 整个 chunk 长度（uint32）

const RES_XML_TYPE = 0x0003
const RES_STRING_POOL_TYPE = 0x0001
const RES_XML_START_ELEMENT_TYPE = 0x0102
const UTF8_FLAG = 0x00000100

/** 字符串池里的「没有这个字符串」 */
const NO_INDEX = 0xffffffff

/** 属性值类型：只区分我们要的字符串与整数，其余按原样跳过 */
const TYPE_STRING = 0x03
const TYPE_INT_DEC = 0x10
const TYPE_INT_HEX = 0x11

interface AxmlAttribute {
  name: string
  /** 字符串池里的原始值；不是字符串类型时为 undefined */
  text: string | undefined
  /** 整数类型时的值，用来取 versionCode */
  int: number | undefined
}

interface AxmlElement {
  name: string
  attributes: AxmlAttribute[]
}

/** 读一个变长长度：最高位为 1 表示要两字节（AXML 字符串池的长度前缀就是这么编的） */
function readLength8(buf: Buffer, offset: number, end: number): { value: number; next: number } {
  const first = buf[offset]
  if ((first & 0x80) === 0) {
    return { value: first, next: offset + 1 }
  }
  // 两字节形式：池被截断时第二字节可能越界，退回长度 0，让上层拿到空串而不是读越界
  if (offset + 1 >= end) {
    return { value: 0, next: offset + 1 }
  }
  return { value: ((first & 0x7f) << 8) | buf[offset + 1], next: offset + 2 }
}

/** 读一个变长长度（uint16 版） */
function readLength16(buf: Buffer, offset: number): { value: number; next: number } {
  const first = buf.readUInt16LE(offset)
  if ((first & 0x8000) === 0) {
    return { value: first, next: offset + 2 }
  }
  return { value: ((first & 0x7fff) << 16) | buf.readUInt16LE(offset + 2), next: offset + 4 }
}

/**
 * 字符串池布局：
 *   +8 字符串数 / +12 样式数 / +16 标志位 / +20 字符串数据起点 / +24 样式数据起点
 *   +headerSize 起是偏移数组（每项 uint32，相对字符串数据起点）
 *
 * 字符串本身：UTF-8 池是「字符数（变长）+ 字节数（变长）+ 数据」，
 * UTF-16 池是「字符数（变长）+ 数据」。
 */
function parseStringPool(
  buf: Buffer,
  chunkOffset: number,
  headerSize: number,
  chunkSize: number,
): string[] {
  const count = buf.readUInt32LE(chunkOffset + 8)
  const flags = buf.readUInt32LE(chunkOffset + 16)
  const stringsStart = buf.readUInt32LE(chunkOffset + 20)
  const stylesStart = buf.readUInt32LE(chunkOffset + 24)
  const utf8 = (flags & UTF8_FLAG) !== 0

  const offsetsStart = chunkOffset + headerSize
  const stringsBase = chunkOffset + stringsStart
  const stringsEnd = stylesStart === 0 ? chunkOffset + chunkSize : chunkOffset + stylesStart

  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    const relative = buf.readUInt32LE(offsetsStart + i * 4)
    const at = stringsBase + relative
    if (at < stringsBase || at >= stringsEnd) {
      out.push('')
      continue
    }
    if (utf8) {
      const chars = readLength8(buf, at, stringsEnd)
      const bytes = readLength8(buf, chars.next, stringsEnd)
      out.push(buf.toString('utf8', bytes.next, bytes.next + bytes.value))
    } else {
      const chars = readLength16(buf, at)
      out.push(buf.toString('utf16le', chars.next, chars.next + chars.value * 2))
    }
  }
  return out
}

/**
 * start element 布局（在 8 字节公共头之后）：
 *   +8 行号 / +12 注释 / +16 命名空间 / +20 元素名 / +24 属性起点（相对 +16）
 *   +26 每条属性长度（固定 20）/ +28 属性条数
 *
 * 每条属性 20 字节：
 *   +0 命名空间 / +4 名字 / +8 原始值（字符串池索引）/ +12 值长度 / +15 类型 / +16 数据
 */
function parseStartElement(
  buf: Buffer,
  chunkOffset: number,
  chunkSize: number,
  strings: string[],
): AxmlElement {
  const nameIndex = buf.readUInt32LE(chunkOffset + 20)
  const attributeStart = buf.readUInt16LE(chunkOffset + 24)
  const attributeSize = buf.readUInt16LE(chunkOffset + 26)
  const attributeCount = buf.readUInt16LE(chunkOffset + 28)
  const attributesAt = chunkOffset + 16 + attributeStart
  const chunkEnd = chunkOffset + chunkSize

  const attributes: AxmlAttribute[] = []
  if (attributeSize >= 20 && attributesAt + attributeCount * attributeSize <= chunkEnd) {
    for (let i = 0; i < attributeCount; i += 1) {
      const at = attributesAt + i * attributeSize
      const attributeName = strings[buf.readUInt32LE(at + 4)] ?? ''
      const rawIndex = buf.readUInt32LE(at + 8)
      const type = buf[at + 15]
      const data = buf.readUInt32LE(at + 16)

      let text: string | undefined
      let int: number | undefined
      if (type === TYPE_STRING) {
        text = strings[data]
      } else if (type === TYPE_INT_DEC || type === TYPE_INT_HEX) {
        int = data
        text = String(data)
      }
      // 原始值那一栏是给人看的字符串版本，有就优先用它
      if (rawIndex !== NO_INDEX && strings[rawIndex] !== undefined) {
        text = strings[rawIndex]
      }
      attributes.push({ name: attributeName, text, int })
    }
  }

  return { name: strings[nameIndex] ?? '', attributes }
}

/** 把整份 AXML 走一遍，回所有 start element（顺序即文档顺序） */
function parseAxml(buf: Buffer): AxmlElement[] {
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) {
    return []
  }
  const elements: AxmlElement[] = []
  let strings: string[] = []
  let cursor = buf.readUInt16LE(2)

  while (cursor + 8 <= buf.length) {
    const type = buf.readUInt16LE(cursor)
    const headerSize = buf.readUInt16LE(cursor + 2)
    const chunkSize = buf.readUInt32LE(cursor + 4)
    if (chunkSize < 8 || cursor + chunkSize > buf.length) {
      break
    }
    if (type === RES_STRING_POOL_TYPE) {
      strings = parseStringPool(buf, cursor, headerSize, chunkSize)
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      elements.push(parseStartElement(buf, cursor, chunkSize, strings))
    }
    cursor += chunkSize
  }
  return elements
}

// ── 对外 ─────────────────────────────────────────────────────────────────────

const EMPTY: ApkManifest = { packageName: '', versionName: '', versionCode: '', label: '' }

/**
 * 读一个 APK 的清单。
 *
 * 任何一步读不出来都返回空字段而不是抛错：调用方多半只是想「顺手多拿一点信息」，
 * 为此把整个导入流程弄失败不划算。
 */
export function readApkManifest(apkPath: string): ApkManifest {
  let buf: Buffer
  try {
    buf = fs.readFileSync(apkPath)
  } catch {
    return EMPTY
  }

  const manifestBytes = readZipEntry(buf, 'AndroidManifest.xml')
  if (!manifestBytes) {
    return EMPTY
  }

  const root = parseAxml(manifestBytes).find((element) => element.name === 'manifest')
  if (!root) {
    return EMPTY
  }

  const pick = (name: string): AxmlAttribute | undefined =>
    root.attributes.find((attribute) => attribute.name === name)

  const versionCode = pick('versionCode')
  const labelAttribute = root.attributes.find((attribute) => attribute.name === 'label')

  return {
    packageName: pick('package')?.text ?? '',
    versionName: pick('versionName')?.text ?? '',
    versionCode: versionCode?.int !== undefined ? String(versionCode.int) : (versionCode?.text ?? ''),
    label: labelAttribute?.text ?? '',
  }
}
