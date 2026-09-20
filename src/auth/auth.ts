/* 登录态管理：目前是「前端模拟登录」，把 token 存 localStorage。
   接真实后台时只需要改 login() 一个函数，其它地方不用动。 */

const TOKEN_KEY = 'patrol_token'
const USER_KEY = 'patrol_user'

export interface LoginUser {
  username: string
  /** 展示用的昵称，没有就用 username */
  displayName: string
}

/** 读取登录令牌；未登录返回空字符串 */
export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

/** 是否已登录（只看本地有没有 token，不校验有效期） */
export function isAuthed(): boolean {
  return Boolean(getToken())
}

/** 读取当前登录用户；没有则返回 null */
export function getUser(): LoginUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LoginUser
  } catch {
    return null
  }
}

/** 写入登录态（token + 用户信息） */
function persist(token: string, user: LoginUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/** 退出登录：清掉本地登录态 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/**
 * 登录。
 *
 * 现在是本地模拟：账号 admin / 密码 123456，其它组合一律报错。
 * 接真实接口时把下面「模拟校验」那段换成 fetch 即可，
 * 保持返回 Promise<LoginUser>、失败时 throw Error 的契约不变。
 *
 * 参考改法：
 *   const res = await fetch(`${import.meta.env.VITE_SERVER}/auth/login`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ username, password }),
 *   })
 *   if (!res.ok) throw new Error('账号或密码错误')
 *   const data = await res.json()
 *   persist(data.token, { username, displayName: data.realName ?? username })
 */
export async function login(username: string, password: string): Promise<LoginUser> {
  // 模拟网络延迟，让 loading 态看得见
  await new Promise((resolve) => setTimeout(resolve, 400))

  // ---- 模拟校验（接真实接口时删除这段）----
  if (username.trim() !== 'admin' || password !== '123456') {
    throw new Error('账号或密码错误（演示账号：admin / 123456）')
  }
  const user: LoginUser = { username: username.trim(), displayName: '管理员' }
  persist(`mock-token-${Date.now()}`, user)
  return user
}
