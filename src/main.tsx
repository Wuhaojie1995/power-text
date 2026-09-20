import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// antd 的全局样式重置（v6 的 CSS-in-JS 只管组件样式，reset 需要单独引入）。
// 必须放在最前面，后面我们自己的主题样式才能覆盖 antd 默认值。
import 'antd/dist/reset.css'
// 全局主题变量与基础布局（必须早于各页面样式，页面 css 依赖这里的 CSS 变量）
import './styles/global.less'
import './index.less'
import App from './App.tsx'
import { dismissAppLoading } from './lib/app-loading'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * 收起首屏蒙层（那个转圈动画在 index.html 里）。
 *
 * 等两帧再收：render() 只是把更新提交给 React，浏览器这一刻还没画，
 * 立刻撤蒙层会露出底下尚未绘制的一帧白屏 —— 也就是白闪。
 *
 * 这里不等任何异步资源（三维背景、接口数据都不等）：
 * 蒙层挡住的应该是「页面还没出来」，而不是「装饰还没加载完」，
 * 让用户对着一个转圈等 600KB 的背景包，是把加载动画用反了。
 */
requestAnimationFrame(() => {
  requestAnimationFrame(dismissAppLoading)
})
