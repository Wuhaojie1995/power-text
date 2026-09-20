import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Result } from 'antd'
import { ROUTE_PATHS } from '../../router/paths'
import './not-found.less'

/**
 * 404 页：兜底所有未匹配的路径。
 *
 * 它挂在根路由的 errorElement 上，而不是塞一条 path:'*' 的路由。
 * 原因见 src/router/index.tsx 的注释：顶层一旦有 splat 路由，
 * 它会把 path:'/' 的首页也吃掉，导致首页打不开。
 *
 * 因此它不带主框架的侧边菜单，是一个独立的整页结果页 ——
 * 主按钮直接给「回首页」，首页上有完整导航，不会变成死胡同。
 */
export default function NotFoundPage() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="not-found-page page-fade-in">
      <Result
        status="404"
        title="404"
        subTitle="抱歉，你访问的页面不存在或已被移除"
        extra={
          <>
            <Button type="primary" onClick={() => navigate(ROUTE_PATHS.HOME, { replace: true })}>
              回到首页
            </Button>
            {/* 有上一步历史才提供「返回上一页」，否则点了没反应 */}
            {window.history.length > 1 ? <Button onClick={() => navigate(-1)}>返回上一页</Button> : null}
          </>
        }
      >
        <p className="not-found-path">
          未匹配的路径：<code>{location.pathname}</code>
        </p>
      </Result>
    </div>
  )
}
