/**
 * 字体栈的 TS 副本，给 antd 用。
 *
 * 为什么需要这份「重复」：antd 的 ConfigProvider 只认 JS 值，读不到 Less 变量，
 * 不显式喂进去的话，antd 组件（按钮、输入框、弹窗、表格……）会用它自己的默认字体栈，
 * 于是同一页面上「自己写的 div」和「antd 组件」是两套字，一眼能看出接缝。
 *
 * ⚠️ 改这里必须同步改两处，三边保持一致：
 *   ① styles/variables.less 的 @font-light / @font-medium（自写 CSS 用）
 *   ② styles/global.less 的 @font-face 家族名（字体从哪来）
 * 第一项的名字必须和本文件第一项逐字相同，否则自写 CSS 和 antd 组件会分成两套字。
 *
 * 字体本身是自托管的（src/styles/font/PingFangSC-*.ttf），@font-face 里 local() 优先，
 * 所以 macOS / iOS 用系统字面、Windows / Android 才下载。细节见 global.less 的注释。
 *
 * 两边刻意都是完整字面量而不是拼接，就是为了让人肉比对时能直接对上。
 */

/** 正文字族（PingFang SC-Light）。对应 Less 变量 @font-light，@font-face 在 global.less */
export const FONT_LIGHT =
  "'PingFang SC-Light', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"

/** 加粗字族（PingFang SC-Medium）。对应 Less 变量 @font-medium，@font-face 在 global.less */
export const FONT_MEDIUM =
  "'PingFang SC-Medium', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif"
