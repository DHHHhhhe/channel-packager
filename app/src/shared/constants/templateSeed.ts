import type { TemplateSuffix } from '../types/store'

/**
 * 模板种子：从工作目录的 channelConfig.sample.json 取带别名的渠道，剥掉渠道前缀后固化在这里。
 *
 * 为什么不运行时读那个文件：打包成 exe 后仓库文件不在，应用必须自包含。
 * 这里只是新装应用的初始模板，用户改的是 data/template.json，与本常量无关。
 */
export const TEMPLATE_SEED: readonly TemplateSuffix[] = [
  { suffix: 'jl_flow', alias: '巨量' },
  { suffix: 'ks_flow', alias: '快手' },
  { suffix: 'tx_flow', alias: '腾讯' },
  { suffix: 'gf', alias: '官方' },
  { suffix: 'hw', alias: '华为' },
  { suffix: 'xm', alias: '小米' },
  { suffix: 'oppo', alias: 'OPPO' },
  { suffix: 'vivo', alias: 'VIVO' },
  { suffix: 'honor', alias: '荣耀' },
  { suffix: 'mz', alias: '魅族' },
  { suffix: 'bd', alias: '百度' },
  { suffix: 'yyb', alias: '应用宝' },
  { suffix: 'uc', alias: 'UC' },
]

