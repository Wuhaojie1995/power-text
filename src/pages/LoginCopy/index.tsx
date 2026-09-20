import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Form, Input, Typography } from 'antd'
import { LockOutlined, MoonOutlined, RobotOutlined, SunOutlined, UserOutlined } from '@ant-design/icons'
import { isAuthed, login } from '../../auth/auth'
import { envConfig, envLabel, isDev } from '../../config/env'
import { ROUTE_PATHS } from '../../router/paths'
import './login.less'

/** 主题偏好存储键。注意 index.html 里的首屏底色脚本也读这个键，改名要一起改 */
const THEME_STORAGE_KEY = 'patrol_login_theme'
/** 首屏底色样式节点的 id：index.html 负责创建，这里负责跟着主题更新 */
const THEME_STYLE_ID = 'login-theme-bg'
/** 深色主题的页面底色，要和 login.less 里 .login-page 深色底的起始色一致 */
const DARK_BG = '#060b1c'

type LoginTheme = 'dark' | 'light'

/** 读取上次选择的主题；没选过或读不到就默认深色 */
function getInitialTheme(): LoginTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** 拿到（必要时创建）首屏底色样式节点 */
function ensureThemeStyleEl(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID)
  if (existing instanceof HTMLStyleElement) return existing
  const el = document.createElement('style')
  el.id = THEME_STYLE_ID
  document.head.appendChild(el)
  return el
}

/**
 * 登录页。
 *
 * 两个跳转规则：
 * 1) 已经登录了还访问 /login → 直接送回业务页，避免出现「登录页套登录态」；
 * 2) 登录成功后优先跳回「被拦截前想去的地址」（守卫存在 state.from 上），
 *    没有记录就回默认页 /chat。
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [form] = Form.useForm<{ username: string; password: string }>()
  const [theme, setTheme] = useState<LoginTheme>(getInitialTheme)

  /** 被路由守卫拦截时记下的原地址 */
  const from = (location.state as { from?: string } | null)?.from ?? ROUTE_PATHS.CHAT

  useEffect(() => {
    if (isAuthed()) navigate(ROUTE_PATHS.CHAT, { replace: true })
  }, [from, navigate])

  /**
   * 让 html/body 的底色跟上主题。
   *
   * 为什么需要这个：登录页是整屏深色，但 React 要等 JS 下载解析完才挂载，
   * 这期间 <body> 按默认白底渲染会「白屏闪一下」。所以 index.html 里有个内联脚本
   * 在首屏前就把底色定下来，这里接管后续（切换主题、以及离开登录页时清掉）。
   * 必须带 !important —— index.less 的 `:root` 是伪类，特异性高于 `html`，靠选择器压不过。
   */
  useEffect(() => {
    ensureThemeStyleEl().textContent =
      theme === 'dark' ? `html,body{background-color:${DARK_BG} !important}` : ''
    return () => {
      // 离开登录页时清空，避免深色底色影响其它浅色页面
      const el = document.getElementById(THEME_STYLE_ID)
      if (el) el.textContent = ''
    }
  }, [theme])

  const toggleTheme = () => {
    const next: LoginTheme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* 存不了不影响本次会话生效 */
    }
    setTheme(next)
  }

  const handleSubmit = async (values: { username: string; password: string }) => {
    try {
      await login(values.username, values.password)
      // replace:true —— 登录页不该留在历史栈里，否则用户点「后退」会退回到登录页
      navigate(from, { replace: true })
    } catch (err) {
      // 把错误挂在密码框上，比弹全局提示更贴近出错位置
      form.setFields([
        {
          name: 'password',
          errors: [err instanceof Error ? err.message : '登录失败，请重试'],
        },
      ])
    }
  }

  return (
    <div className={`login-page${theme === 'light' ? ' is-light' : ''}`}>
      {/*
        动态背景，纯装饰（aria-hidden 让读屏软件忽略）。
        五个子层按顺序叠：静态光晕 → 细网格 → 横向光束 → 纵向光束 → 斜向扫光。
        光束的 <i> 只是「轨道」，真正的光由 CSS 的 background-image + 位移动画画出来。
      */}
      <div className="login-bg" aria-hidden="true">
        <span className="login-bg-glow" />
        <span className="login-bg-grid" />
        <span className="login-bg-lines">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="login-bg-cols">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="login-bg-sweep" />
      </div>

      {/* 切换的是「点一下会切到哪个主题」，所以图标显示目标主题，文案也说清楚 */}
      <button
        type="button"
        className="login-theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      >
        {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
      </button>

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">
            <RobotOutlined />
          </div>
          <Typography.Title level={4} className="login-title">
            {envConfig.TITLE}
          </Typography.Title>
          <p className="login-subtitle">AI 智能巡视记录助手</p>
          <span className={`env-tag env-${isDev ? 'development' : 'production'}`}>{envLabel}</span>
        </div>

        <Form
          form={form}
          className="login-form"
          size="large"
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          initialValues={{ username: 'admin', password: '123456' }}
        >
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" allowClear />
          </Form.Item>

          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 12 }}>
            <Button type="primary" htmlType="submit" block className="login-submit">
              登录
            </Button>
          </Form.Item>

          {/* 演示阶段的账号提示，接入真实登录后删掉这一行 */}
          <p className="login-tip">演示账号：admin / 123456</p>
        </Form>
      </div>
    </div>
  )
}
