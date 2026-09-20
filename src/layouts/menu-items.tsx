import type { ReactNode } from 'react'
import type { MenuProps } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { ROUTE_PATHS } from '../router/paths'

/**
 * 侧边菜单配置（新增页面只改这里 + 路由表两处）。
 *
 * key 必须与路由表的 path 完全一致：菜单的「高亮/选中」是直接拿
 * 当前 location.pathname 去比对 key 的，不一致会导致点进去不高亮。
 */
export interface NavMenuItem {
  key: string
  icon: ReactNode
  label: string
}

export const navMenuItems: NavMenuItem[] = [
  {
    key: ROUTE_PATHS.CHAT,
    icon: <RobotOutlined />,
    label: 'AI 智能巡视',
  },
]

/** 转成 antd Menu 需要的结构 */
export const antdMenuItems: MenuProps['items'] = navMenuItems.map((item) => ({
  key: item.key,
  icon: item.icon,
  label: item.label,
}))
