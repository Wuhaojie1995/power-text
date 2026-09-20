import { RouterProvider } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { router } from './router'
import { FONT_LIGHT } from './styles/fonts'

/**
 * 应用根组件：只做「全局装配」，不写任何页面内容。
 *
 * 职责就两件事：
 *   1) ConfigProvider —— 给全站注入 antd 主题与中文文案；
 *   2) RouterProvider —— 把路由表挂上去，具体界面由路由自己决定渲染谁。
 *
 * 界面分三层，各司其职：
 *   App（主题 + 路由）
 *     └── BasicLayout（顶栏 + 侧边菜单，纯壳）
 *           └── pages/*（真正的业务页面，如 ChatPage / NotFoundPage）
 *   登录页是例外，它不带框架，单独占一条路由。
 *
 * ConfigProvider 说明：
 * - theme.algorithm = theme.defaultAlgorithm：亮色主题（与整页白色背景统一）；
 * - token.colorPrimary：主色调蓝，按钮/选中态/焦点框都跟着它走；
 * - token.colorText：全局文字色统一为 #333437，和自写 CSS 保持一致；
 * - locale：组件内置文案（如「清空」「请选择」）转成中文。
 */
export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          colorText: '#333437',
          colorTextHeading: '#333437',
          borderRadius: 8,
          // 把正文字族也喂给 antd。不写这一条，antd 组件会用自带的默认字体栈，
          // 和自写 CSS 的 PingFang 并排时能看出两套字（见 styles/fonts.ts 的说明）
          fontFamily: FONT_LIGHT,
        },
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  )
}
