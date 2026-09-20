import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isAuthed } from './auth'
import { ROUTE_PATHS } from '../router/paths'
import type { HomeLoginState } from '../router/paths'

/**
 * 路由守卫：包在需要登录才能访问的路由外面。
 * - 已登录：渲染子路由（Outlet）
 * - 未登录：重定向到首页，并带上两样东西：
 *     ① needLogin —— 首页看到它会自动弹出登录框；
 *     ② from      —— 原本想去哪，登录成功后跳回去，而不是一律落到默认页。
 *
 * 为什么要多带一个 needLogin：登录已经不是一个独立页面了，
 * 首页在「用户主动点登录」和「被守卫拦下来」这两种情况下长得一模一样，
 * 只有靠这个标记才能区分「该不该主动把弹窗推出来」。
 *
 * 用法（在路由表里当父节点）：
 *   { element: <RequireAuth />, children: [ ...需要登录的路由 ] }
 */
export default function RequireAuth() {
  const location = useLocation()

  if (!isAuthed()) {
    const state: HomeLoginState = {
      needLogin: true,
      from: location.pathname + location.search,
    }
    return <Navigate to={ROUTE_PATHS.HOME} replace state={state} />
  }

  return <Outlet />
}
