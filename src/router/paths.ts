/**
 * 路由路径常量。
 *
 * 集中定义是为了避免「字符串散落各处」：菜单配置、页面跳转、守卫重定向
 * 都从这里取，改路径只需要改这一处，不会出现改了路由表忘了改菜单的坑。
 */
export const ROUTE_PATHS = {
  /**
   * 作品集首页（不需要登录态）。
   *
   * 这一条同时承担了原来 LOGIN 的职责：登录不再是「一个页面」，
   * 而是首页上的一层弹窗。所以未登录用户被拦截时回到这里，而不是回到一张独立的登录页。
   */
  HOME: '/',
  /**
   * 旧登录页地址。保留常量只为兼容两处历史引用：
   * ① 浏览器里存着的 /login 书签；② index.html 首屏底色脚本对路径的判断。
   * 路由表里它只是一条重定向到首页的规则，不再渲染任何页面。
   */
  LOGIN: '/login',
  /** AI 智能巡视对话页（登录后默认落地页） */
  CHAT: '/chat',
} as const

/**
 * 打开首页登录弹窗的路由 state 形状。
 *
 * 用 state 而不是「/login?needLogin=1」这种查询串，是为了不把内部标记写进 URL ——
 * 地址栏干净，分享出去的链接也不会带上「请弹登录框」这种指令。
 *
 * 但注意：state 会落进 history.state，而 history.state **刷新不清空**。
 * 所以光靠 state 并不能防止「刷新一下弹窗又冒出来」，消费方（HomePage）
 * 必须在读到 needLogin 之后立刻用 replace 把 state 抹成 null。详见那里的注释。
 */
export interface HomeLoginState {
  /** 置 true 时首页挂载后自动展开登录弹窗。消费方读完应立即清除 */
  needLogin?: boolean
  /** 被拦截前想去的地址，登录成功后跳回去 */
  from?: string
}
