import { useMemo, useState } from 'react'
import { useLocation, useNavigate, Outlet } from 'react-router-dom'
import { Layout, Menu, Dropdown, Avatar, Button, Space } from 'antd'
import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { envConfig, envLabel, isDev } from '../config/env'
import { getUser, logout } from '../auth/auth'
import { antdMenuItems } from './menu-items'
import { ROUTE_PATHS } from '../router/paths'
import './basic-layout.less'

const { Header, Sider, Content } = Layout

/**
 * 后台主框架：顶栏 + 侧边菜单 + 内容区。
 *
 * 这一层只负责「壳」，不写任何业务：内容区用 <Outlet /> 交给路由去填，
 * 页面组件（如聊天页）完全独立，可单独开发、单独替换。
 */
export default function BasicLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  /** 侧边栏折叠状态（纯 UI 状态，不持久化） */
  const [collapsed, setCollapsed] = useState(false)

  const user = useMemo(() => getUser(), [])
  const displayName = user?.displayName ?? user?.username ?? '未登录'

  /**
   * 菜单选中项：直接用当前路径做 key。
   * 取第一段（/a/b → /a）是为了子路由也能让父级菜单保持高亮。
   */
  const selectedKey = useMemo(() => {
    const seg = location.pathname.split('/').filter(Boolean)[0]
    return seg ? `/${seg}` : ROUTE_PATHS.CHAT
  }, [location.pathname])

  /** 退出登录：清 token 后跳登录页；replace 避免用户点「后退」又回到已登出的页面 */
  const handleLogout = () => {
    logout()
    navigate(ROUTE_PATHS.LOGIN, { replace: true })
  }

  return (
    <Layout className="basic-layout">
      <Header className="basic-header">
        <div className="basic-header-left">
          <Button
            type="text"
            className="basic-collapse-btn"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '展开菜单' : '收起菜单'}
          />
          <h1 className="basic-title">{envConfig.TITLE}</h1>
        </div>

        <div className="basic-header-right">
          <span className="basic-env">
            当前环境：
            <span className={`env-tag env-${isDev ? 'development' : 'production'}`}>{envLabel}</span>
          </span>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: handleLogout,
                },
              ],
            }}
          >
            <Space className="basic-user" size={8}>
              <Avatar className="basic-avatar">{displayName.slice(0, 1)}</Avatar>
              <span className="basic-user-name">{displayName}</span>
            </Space>
          </Dropdown>
        </div>
      </Header>

      <Layout className="basic-body">
        <Sider className="basic-sider" width={208} collapsed={collapsed} theme="light">
          <Menu
            className="basic-menu"
            mode="inline"
            items={antdMenuItems}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => navigate(key)}
          />
        </Sider>

        {/* 内容区：min-height:0 让内部页面可以用 flex 撑满并自己滚动 */}
        <Content className="basic-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
