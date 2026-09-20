import { createBrowserRouter, Navigate } from 'react-router-dom'
import BasicLayout from '../layouts/BasicLayout'
import RequireAuth from '../auth/RequireAuth'
import ChatPage from '../pages/Chat'
import HomePage from '../pages/Home'
import NotFoundPage from '../pages/NotFound'
import { envConfig } from '../config/env'
import { ROUTE_PATHS } from './paths'

/**
 * 路由表（react-router v6 的 createBrowserRouter）。
 *
 * 相比改造前有两点变化：
 *
 * 1) 根路径 / 从「重定向到业务页」变成了首页本身。原来它挂在守卫后面、
 *    落地时直接 Navigate 到 /chat，等于「没登录就什么都看不到」。
 *    现在 / 是一个公开的作品集落地页，业务区退到它后面。
 *
 * 2) 登录从「一个页面」变成了「首页上的弹窗」。所以 /login 只剩一条重定向，
 *    用来兼容浏览器里存着的旧书签；真正的登录入口在首页右上角。
 *
 * 关于整体结构：所有路由都收在一条 path:'/' 的根路由下，首页是它的 index 子路由。
 * 这样写是被逼的，不是风格偏好 ——
 *
 *   实测（@remix-run/router 6.x）：**顶层只要存在 path:'*' 的兜底路由，
 *   它就会压过 path:'/'**。四种写法都试过，无论是把 splat 放顶层、
 *   还是放进一条无 path 的布局路由里，'/' 都会被 404 分支吃掉。
 *   症状非常隐蔽：RequireAuth 把用户重定向到首页 → 首页又被 404 分支接管 →
 *   渲染的仍是 RequireAuth → 再重定向，浏览器报「Maximum update depth exceeded」，
 *   页面全白。所以这里干脆不用 splat。
 *
 *   改用 errorElement 兜底：react-router 在「一条都没匹配上」时，
 *   会把 path 为 '/' 的那条路由当作短路分支（见 getShortCircuitMatches），
 *   用它渲染错误边界。也就是说 /nope 这种地址会直接落到根路由的 errorElement 上。
 *
 * basename 取自环境变量（部署到子目录时配置 VITE_BASENAME），
 * 与 vite.config.ts 的 base 保持一致。
 */
export const router = createBrowserRouter(
  [
    {
      path: ROUTE_PATHS.HOME,
      // 未匹配路径的兜底页面。放在根路由上，而不是塞一条 path:'*' —— 原因见上面的注释
      errorElement: <NotFoundPage />,
      children: [
        {
          // 首页（作品集落地页），免登录
          index: true,
          element: <HomePage />,
        },
        {
          // 旧登录地址：登录已收进首页弹窗，这里只做重定向，兼容老书签
          path: ROUTE_PATHS.LOGIN.replace(/^\//, ''),
          element: <Navigate to={ROUTE_PATHS.HOME} replace />,
        },
        {
          // 业务区：登录守卫 → 主框架 → 页面
          path: ROUTE_PATHS.CHAT.replace(/^\//, ''),
          element: <RequireAuth />,
          children: [
            {
              // 无 path 的布局路由：BasicLayout 只负责外壳，
              // 真正的页面由它下面的 index 子路由渲染
              element: <BasicLayout />,
              children: [{ index: true, element: <ChatPage /> }],
            },
          ],
        },
      ],
    },
  ],
  { basename: envConfig.BASENAME || undefined },
)
