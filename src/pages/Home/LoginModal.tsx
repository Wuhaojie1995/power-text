import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ConfigProvider, Form, Input, Modal, theme } from 'antd'
import { LockOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import { login } from '../../auth/auth'
import { envConfig, envLabel, isDev } from '../../config/env'

interface LoginModalProps {
  open: boolean
  /** 当前是不是深色主题。弹窗被 portal 到 <body> 下，拿不到 .home-page 的类，只能显式传进来 */
  dark: boolean
  /** 登录成功后跳去哪。被路由守卫拦下来的话，这里是被拦之前的地址 */
  redirectTo: string
  onClose: () => void
}

/**
 * 登录弹窗。
 *
 * 原来是独立的一页（/login），现在收进首页的一层弹窗：
 * 首页是给人看的作品集，不该被一道登录墙拦在外面；
 * 但业务系统又确实需要登录态，所以把「门」做成了首页上的一个按钮。
 *
 * 两处和 antd 相关的坑：
 *
 * 1) **主题要单独喂给 ConfigProvider**。App 层配的是浅色主题（业务页面都是白底），
 *    而首页是深色的，弹窗如果跟着 App 的浅色走，会在深色页面上弹出一块刺眼的白板。
 *    所以这里按当前主题重挂一层 ConfigProvider，把 darkAlgorithm 传下去，
 *    Input / Button 这些组件的内置颜色才会跟着变。
 *
 * 2) **class 要同时给 className 和 rootClassName**。Modal 的结构是
 *    .ant-modal-root > .ant-modal-wrap > .ant-modal > .ant-modal-content，
 *    两个 prop 挂的层级不同；同时给上，portfolio.less 里不管写在哪一层都能选中。
 */
export default function LoginModal({ open, dark, redirectTo, onClose }: LoginModalProps) {
  const navigate = useNavigate()
  const [form] = Form.useForm<{ username: string; password: string }>()
  const [submitting, setSubmitting] = useState(false)

  /**
   * 每次重新打开都把表单重置一次。
   * 不重置的话，上一次输错密码留下的红字会跟着弹窗再出现一遍 ——
   * 用户还没动手就先被报了个错，很莫名其妙。
   */
  useEffect(() => {
    if (open) form.resetFields()
  }, [open, form])

  const handleSubmit = async (values: { username: string; password: string }) => {
    setSubmitting(true)
    try {
      await login(values.username, values.password)
      onClose()
      // replace: 登录成功后不该还能「后退」回首页登录前的状态
      navigate(redirectTo, { replace: true })
    } catch (err) {
      // 错误挂在密码框上，比弹一个全局 toast 更贴近出错位置
      form.setFields([
        {
          name: 'password',
          errors: [err instanceof Error ? err.message : '登录失败，请重试'],
        },
      ])
    } finally {
      setSubmitting(false)
    }
  }

  const modalClass = `home-login-modal${dark ? ' is-dark' : ''}`

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      centered
      // 点遮罩不关：这是登录入口，误触关掉会让人以为「点了没反应」。
      // 用 mask.closable 而不是 maskClosable —— 后者在 antd 6 已废弃
      mask={{ closable: false }}
      className={modalClass}
      rootClassName={modalClass}
      // destroyOnClose 在 antd 6 已废弃，改用 destroyOnHidden：
      // 关掉就把表单整个卸载，下次打开一定是干净的初始状态
      destroyOnHidden
    >
      <ConfigProvider
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: '#2563eb',
            borderRadius: 8,
            /**
             * colorText / colorTextHeading 必须显式写死，不能只靠 algorithm。
             *
             * App 层为了跟手写 CSS 对齐，把 colorText 定成了 #333437。antd 的 token 是
             * 「父级 ConfigProvider 合并进子级」的 —— 子级只换 algorithm 压不住它，
             * 结果就是暗色算法算出来的字色又被 #333437 覆盖回去。
             * 表现：深色弹窗上 label「账号/密码」和输入框里的字全是深灰，等于隐身。
             *
             * 所以这里两套主题各给一份字色。改的是弹窗自己的作用域，不影响业务页面。
             */
            colorText: dark ? 'rgba(255, 255, 255, 0.88)' : '#333437',
            colorTextHeading: dark ? 'rgba(255, 255, 255, 0.92)' : '#333437',
            colorTextPlaceholder: dark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.25)',
          },
        }}
      >
        <div className="home-login-head">
          <div className="home-login-logo">
            <RobotOutlined />
          </div>
          <h3>{envConfig.TITLE}</h3>
          <p>AI 智能巡视记录助手</p>
          <span className={`env-tag env-${isDev ? 'development' : 'production'}`}>{envLabel}</span>
        </div>

        <Form
          form={form}
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
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting}
              className="home-login-submit"
            >
              登录
            </Button>
          </Form.Item>

          {/* 演示阶段的账号提示，接入真实登录后随这段 JSX 一起删掉 */}
          <p className="home-login-tip">演示账号：admin / 123456</p>
        </Form>
      </ConfigProvider>
    </Modal>
  )
}
