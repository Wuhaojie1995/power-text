import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BgColorsOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { isAuthed } from '../../auth/auth'
import { ROUTE_PATHS } from '../../router/paths'
import type { HomeLoginState } from '../../router/paths'
import HomeBackground from './backgrounds/HomeBackground'
import {
  BACKGROUND_OPTIONS,
  BACKGROUND_STORAGE_KEY,
  DEFAULT_BACKGROUND,
  isWebglBackground,
} from './backgrounds/types'
import type { BackgroundId } from './backgrounds/types'
import LoginModal from './LoginModal'
import {
  CONTACTS,
  FOOTER_TEXT,
  JOURNEY,
  NAV_ITEMS,
  PROFILE,
  PROJECTS,
  PROJECT_FILTERS,
  SITE_TITLE,
  SKILLS,
  STRENGTHS,
} from './content'
import type { ProjectCategory } from './content'
import './home.less'

/** 主题偏好存储键。注意 index.html 里的首屏底色脚本也读这个键，改名要一起改 */
const THEME_STORAGE_KEY = 'patrol_login_theme'
/** 首屏底色样式节点的 id：index.html 负责创建，这里负责跟着主题更新 */
const THEME_STYLE_ID = 'login-theme-bg'
/**
 * 挂在 <html> 上的滚动条主题类名。样式在 home.less 末尾。
 * index.html 的首屏脚本也写这两个字符串，改名要一起改。
 */
const SCROLL_CLASS_DARK = 'home-scroll-dark'
const SCROLL_CLASS_LIGHT = 'home-scroll-light'
/** 深色主题的页面底色，要和 home.less 里 .home-page 深色底的起始色一致 */
const DARK_BG = '#060b1c'

type HomeTheme = 'dark' | 'light'

/** 读取上次选择的主题；没选过或读不到就默认深色 */
function getInitialTheme(): HomeTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** 读取上次选择的背景；值可能是旧版本留下的、已下线的 id，所以要做一次校验 */
function getInitialBackground(): BackgroundId {
  try {
    const stored = localStorage.getItem(BACKGROUND_STORAGE_KEY)
    const matched = BACKGROUND_OPTIONS.find((option) => option.id === stored)
    return matched ? matched.id : DEFAULT_BACKGROUND
  } catch {
    return DEFAULT_BACKGROUND
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
 * 跟随系统的「减少动态效果」偏好。
 *
 * 用 state 而不是当场读一次 matchMedia：用户在系统设置里改了偏好应该实时生效，
 * 而且这个值要参与 render（决定 has-webgl-bg 类加不加），不能只在 effect 里读。
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}

/**
 * 页内板块跳转：自己滚，不走浏览器的锚点跳转。
 *
 * href 保留着（中键新开、复制地址、读屏软件都还认它），但左键点击拦下来。
 * 不拦的话地址栏会多出一段 #strengths，而这一页挂在 BrowserRouter 下 ——
 * hash 变化同样会进一次 history、让路由重新解析一遍，
 * 表现出来就是「点个页内导航，地址却变了」。这里不让地址动。
 *
 * 落点不用自己算：.home-section 上有 scroll-margin-top，
 * 滚动时会把它一起算进去，导航栏不会压住标题。
 */
function scrollToSection(event: ReactMouseEvent<HTMLAnchorElement>, id: string) {
  // 中键 / Ctrl / Cmd / Shift 点击是「在新标签页打开」，还给浏览器
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

  const target = document.getElementById(id)
  if (!target) return

  event.preventDefault()
  // 平滑滚动对前庭敏感的人群不友好，这类偏好点击时现读一次就够，不必每帧
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}

/**
 * 导航链接。
 *
 * 悬浮时有「光斑」和「光子环」两层光效要跟着光标走，位置靠 CSS 变量
 * --nav-x / --nav-y 传给伪元素。这是唯一能表达「运行时坐标」的路子：
 * Less 变量是编译期的，光标位置它算不出来。
 * 两个变量只服务这一个组件、不参与主题配色，所以和 styles/variables.less
 * 那套体系不冲突（见 portfolio.less 里 .home-nav-link 段的说明）。
 *
 * 矩形只在 pointerenter 量一次，pointermove 里纯做减法：
 * 每次移动都 getBoundingClientRect() 会强制同步布局，而这一页底下还跑着
 * three.js —— 在 60~120Hz 的鼠标事件里做重排，是白送出去的卡顿。
 */
function NavLink({ id, label }: { id: string; label: string }) {
  const boxRef = useRef<{
    el: HTMLAnchorElement
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  const onPointerEnter = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    boxRef.current = {
      el: event.currentTarget,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const box = boxRef.current
    // 元素对不上说明进的是别的链接，丢掉这一帧（快速划过一排链接时会遇到）
    if (!box || box.el !== event.currentTarget) return
    box.el.style.setProperty('--nav-x', `${(((event.clientX - box.left) / box.width) * 100).toFixed(2)}%`)
    box.el.style.setProperty('--nav-y', `${(((event.clientY - box.top) / box.height) * 100).toFixed(2)}%`)
  }

  return (
    <a
      className="home-nav-link"
      href={`#${id}`}
      onClick={(event) => scrollToSection(event, id)}
      onPointerEnter={onPointerEnter}
      onPointerMove={onPointerMove}
    >
      {label}
    </a>
  )
}

/**
 * 首页（作品集落地页）。
 *
 * 这个页面原来是独立的一条 /login 路由，现在成了站点入口：先让人看到「是谁、做过什么」，
 * 再决定要不要进业务系统。登录退化成页面右上角一个按钮唤起的弹窗，
 * 业务侧的鉴权、守卫、token 全部没动。
 *
 * 外观上仍保留原来那两条独立偏好：
 *   - 主题（深 / 浅）
 *   - 背景动效（CSS 光束 / 四套 3D 场景 / 一套流体模拟）
 * 约束也没变：WebGL 背景只在深色主题下生效，理由见 home.less 顶部注释。
 */
export default function HomePage() {
  const navigate = useNavigate()
  const location = useLocation()

  const [theme, setTheme] = useState<HomeTheme>(getInitialTheme)
  const [background, setBackground] = useState<BackgroundId>(getInitialBackground)
  const [bgPanelOpen, setBgPanelOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState<ProjectCategory | 'all'>('all')
  const bgPickerRef = useRef<HTMLDivElement>(null)

  /**
   * 是否已经滚离顶部。首屏导航栏全透明，滚离后换成实底玻璃 + 投影。
   *
   * 初值直接读一次 scrollY，而不是写死 false：用户带着锚点进来（或刷新在页面中段）时，
   * 首帧就已经是滚动位置了。写死 false 的话首帧会画一版透明导航栏，
   * useEffect 跑完才切成实底 —— 肉眼能看见「闪一下」。
   */
  const [scrolled, setScrolled] = useState(() => window.scrollY > 8)

  /** 被路由守卫拦下来时，守卫会把「原本想去哪」挂在 state 上 */
  const loginState = location.state as HomeLoginState | null
  const needLogin = Boolean(loginState?.needLogin)
  const loginFrom = loginState?.from ?? ROUTE_PATHS.CHAT

  /**
   * 登录成功后要跳去哪。
   *
   * 用 state 存住，而不是每次渲染都从 location.state 现算：
   * 下面那个 effect 会立刻把 history.state 清掉（原因见那里的注释），
   * 清完之后 location.state 就没了，再直接读只会拿到 undefined，
   * 登录成功后就会一律落到默认页，把守卫记下来的「原本想去哪」丢掉。
   */
  const [redirectTo, setRedirectTo] = useState(loginFrom)

  /**
   * 3D 背景是否真的在跑。
   *
   * 三个条件缺一不可：
   * - 选的是 WebGL 背景；
   * - 深色主题（亮点在亮底上没有对比度）；
   * - 系统没开「减少动态效果」—— 整屏持续运动的背景对前庭敏感人群不友好。
   *
   * 这个值同时决定 canvas 要不要渲染，以及 has-webgl-bg 类加不加
   * （后者会关掉 CSS 的网格/光束层）。所以「不满足条件」时必须让它为 false，
   * 页面才能干净地回落到静态 CSS 背景，而不是变成一片空白。
   */
  const prefersReducedMotion = usePrefersReducedMotion()
  const webglActive = isWebglBackground(background) && theme === 'dark' && !prefersReducedMotion

  /**
   * 被守卫拦下来时自动弹登录框，并且**弹完就把 state 清掉**。
   *
   * 依赖项是 needLogin 这个布尔值而不是整个 state 对象：
   * 用对象的话，用户手动关掉弹窗后只要路由 state 的引用变一次，弹窗就会又冒出来。
   *
   * 清 state 这一步是必须的。守卫用 <Navigate replace state={{needLogin:true}} />
   * 把用户踢回首页，这个 state 会写进 history.state，而 history.state 浏览器刷新时
   * **不会清空**。于是每次刷新首页 needLogin 都还是 true，弹窗又自己冒出来一次，
   * 用户会以为登录态丢了（实测复现过：关掉弹窗再刷新，弹窗照样弹）。
   *
   * 用 replace 而不是 push：否则每刷新一次就往历史栈塞一条，后退键会越退越怪。
   */
  useEffect(() => {
    if (!needLogin) return
    setRedirectTo(loginFrom)
    setLoginOpen(true)
    navigate(ROUTE_PATHS.HOME, { replace: true, state: null })
  }, [needLogin, loginFrom, navigate])

  /**
   * 滚离顶部后给导航栏换一套外观：首屏全透明 → 滚动时实底玻璃 + 投影。
   *
   * 判定的是「页面有没有离开顶端」这个全局状态，而不是「某个元素进入视口」，
   * 所以不需要 IntersectionObserver —— 那还得额外放个哨兵元素去盯，反而更绕。
   *
   * rAF 节流：滚动一帧可能触发多次 scroll 事件，用 frame 标记把测量压到每帧一次。
   * setScrolled 在值没变时会被 React 直接跳过，所以不会造成持续重渲染。
   */
  useEffect(() => {
    let frame = 0

    const measure = () => {
      frame = 0
      // 8px 余量：留一点缓冲，免得触控板回弹到顶端时状态反复横跳、底色跟着闪
      setScrolled(window.scrollY > 8)
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  /**
   * 让 html/body 的底色跟上主题。
   *
   * 为什么需要这个：首页是整屏深色，但 React 要等 JS 下载解析完才挂载，
   * 这期间 <body> 按默认白底渲染会「白屏闪一下」。所以 index.html 里有个内联脚本
   * 在首屏前就把底色定下来，这里接管后续（切换主题、以及离开首页时清掉）。
   * 必须带 !important —— index.less 的 `:root` 是伪类，特异性高于 `html`，靠选择器压不过。
   */
  useEffect(() => {
    ensureThemeStyleEl().textContent =
      theme === 'dark' ? `html,body{background-color:${DARK_BG} !important}` : ''

    // 滚动条挂在 <html> 上，样式没法从 .home-page 往下选，只能靠这个类。
    // 放在这里是因为它和底色一样属于「跟着主题走」的东西，生命周期也一致：
    // 离开首页时摘掉，业务页就回到默认滚动条。
    const root = document.documentElement
    root.classList.toggle(SCROLL_CLASS_DARK, theme === 'dark')
    root.classList.toggle(SCROLL_CLASS_LIGHT, theme === 'light')

    return () => {
      // 离开首页时清空，避免深色底色影响其它浅色页面
      const el = document.getElementById(THEME_STYLE_ID)
      if (el) el.textContent = ''
      root.classList.remove(SCROLL_CLASS_DARK, SCROLL_CLASS_LIGHT)
    }
  }, [theme])

  /**
   * 首页挂载时接管 document.title。
   *
   * index.html 里那行静态 <title> 是给业务系统用的（「海港建设工程管理数字化平台」），
   * 但站点入口已经换成作品集，标签页和分享卡片上该显示的是这一版。
   * 卸载时把原标题还回去，业务页面完全不受影响。
   */
  useEffect(() => {
    const previous = document.title
    document.title = SITE_TITLE
    return () => {
      document.title = previous
    }
  }, [])

  /** 点空白处收起背景面板。pointerdown 而不是 click：后者要等抬手，手感发黏 */  useEffect(() => {
    if (!bgPanelOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (bgPickerRef.current?.contains(event.target as Node)) return
      setBgPanelOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBgPanelOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [bgPanelOpen])

  const applyTheme = (next: HomeTheme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* 存不了不影响本次会话生效 */
    }
    setTheme(next)
  }

  const toggleTheme = () => applyTheme(theme === 'dark' ? 'light' : 'dark')

  const selectBackground = (next: BackgroundId) => {
    try {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, next)
    } catch {
      /* 同上 */
    }
    setBackground(next)
    // 选了 3D 背景但当前是浅色主题：顺手把主题切过去，
    // 否则用户点完发现「什么都没变」，还得自己再找一次主题按钮
    if (isWebglBackground(next) && theme === 'light') applyTheme('dark')
    setBgPanelOpen(false)
  }

  /**
   * 进入业务系统。
   * 已经登录过就直接放行，不再弹一次登录框 —— 本地有 token 还让人重新输密码是纯粹的骚扰。
   */
  const handleEnter = () => {
    if (isAuthed()) navigate(ROUTE_PATHS.CHAT)
    else setLoginOpen(true)
  }

  const visibleProjects = useMemo(
    () => (projectFilter === 'all' ? PROJECTS : PROJECTS.filter((item) => item.category === projectFilter)),
    [projectFilter],
  )

  return (
    <div
      className={`home-page${theme === 'light' ? ' is-light' : ''}${webglActive ? ' has-webgl-bg' : ''}`}
    >
      {/* WebGL 背景画布（three 场景与流体模拟共用同一个元素），只有 active 时才有内容 */}
      <HomeBackground background={background} active={webglActive} />

      {/*
        CSS 动态背景，纯装饰（aria-hidden 让读屏软件忽略）。
        五个子层按顺序叠：静态光晕 → 细网格 → 横向光束 → 纵向光束 → 斜向扫光。
        光束的 <i> 只是「轨道」，真正的光由 CSS 的 background-image + 位移动画画出来。

        3D 背景生效时，这里只保留最底层的静态光晕（那层兼作暗角，
        把四周压暗星点才显得亮），其余会动的层由 .has-webgl-bg 关掉，
        免得两套动效互相打架。
      */}
      <div className="home-bg" aria-hidden="true">
        <span className="home-bg-glow" />
        <span className="home-bg-grid" />
        <span className="home-bg-lines">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="home-bg-cols">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="home-bg-sweep" />
      </div>

      {/* ---------------- 导航栏 ---------------- */}
      <header className={`home-nav${scrolled ? ' is-scrolled' : ''}`}>
        {/*
          导航栏是整屏宽的一条（sticky + 滚动态的玻璃底要铺满），
          但里面的内容必须收进和 .home-section 同一个 1180px 内容列，
          否则品牌块会比下方正文的左边缘更靠外、主按钮比卡片右边缘更靠外，一眼就是歪的。
          所以「限宽 + 内边距」这一层单独交给 .home-nav-inner。

          内层是三栏网格（1fr auto 1fr）：品牌靠左、菜单居中、按钮靠右。
          用 grid 而不是 flex + space-between，是因为 auto 两侧的 1fr 等宽，
          中间那栏的**中心**正好落在整行中心上；flex 的 space-between 只能让
          「剩余空间」均分，中间那块的宽度一不对称（菜单 + 分隔线 + 工具按钮）
          居中就偏了。
        */}
        <div className="home-nav-inner">
          <div className="home-brand">
            <div className="home-brand-mark" aria-hidden="true">
              {PROFILE.brandMark}
            </div>
            <div className="home-brand-text">
              <span className="home-brand-name">{PROFILE.brandName}</span>
              <span className="home-brand-sub">{PROFILE.brandSub}</span>
            </div>
          </div>

          {/*
            导航项与工具按钮收进同一个胶囊，中间用一条竖线分隔。
            改之前链接是裸文字、两个工具按钮是带投影的大圆，四样东西散在栏里各说各话；
            收进一个容器之后，中间成为「一整块」。
            胶囊本身的底和描边只在滚动后出现（见 portfolio.less），首屏它是隐形的。
          */}
          <div className="home-nav-cluster">
            <nav className="home-nav-links" aria-label="页面板块">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.id} id={item.id} label={item.label} />
              ))}
            </nav>

            <span className="home-nav-divider" aria-hidden="true" />

            <div className="home-toolbar">
              <div className="home-bg-picker" ref={bgPickerRef}>
                <button
                  type="button"
                  className={`home-tool-btn${bgPanelOpen ? ' is-open' : ''}`}
                  onClick={() => setBgPanelOpen((open) => !open)}
                  title="切换背景动效"
                  aria-label="切换背景动效"
                  aria-expanded={bgPanelOpen}
                  aria-haspopup="menu"
                >
                  <BgColorsOutlined />
                </button>

                {bgPanelOpen && (
                  <div className="home-bg-panel" role="menu" aria-label="背景动效">
                    <p className="home-bg-panel-title">背景动效</p>

                    {BACKGROUND_OPTIONS.map((option) => {
                      const selected = option.id === background
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`home-bg-option${selected ? ' is-active' : ''}`}
                          onClick={() => selectBackground(option.id)}
                        >
                          <span className="home-bg-option-name">
                            {option.label}
                            {option.badge && <em>{option.badge}</em>}
                          </span>
                          <span className="home-bg-option-desc">{option.desc}</span>
                        </button>
                      )
                    })}

                    {theme === 'light' && (
                      <p className="home-bg-panel-tip">这类背景需要深色底，选择后会自动切到深色主题</p>
                    )}
                  </div>
                )}
              </div>

              {/* 切换的是「点一下会切到哪个主题」，所以图标显示目标主题，文案也说清楚 */}
              <button
                type="button"
                className="home-tool-btn"
                onClick={toggleTheme}
                title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
                aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
              >
                {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              </button>
            </div>
          </div>

          {/* 顶栏原来的「登录 / 进入业务系统」圆钮已经去掉：登录改由弹窗承担，
              入口在首屏那个 ghost 按钮（复用 handleEnter）。这里的整块注释保留作记录，
              等确认不再需要之后可以一并删掉 */}
        </div>
      </header>

      <main className="home-main">
        {/* ---------------- 首屏 ---------------- */}
        <section className="home-section home-hero" id="hero">
          <span className="home-hero-status">
            <i aria-hidden="true" />
            {PROFILE.status}
          </span>

          <h1 className="home-hero-name">
            {PROFILE.name}
            <span className="home-hero-latin">{PROFILE.latin}</span>
          </h1>

          <p className="home-hero-role">{PROFILE.role}</p>

          <div className="home-hero-tags">
            {PROFILE.tags.map((tag) => (
              <span className="home-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>

          <div className="home-hero-actions">
            <a
              className="home-btn home-btn-primary"
              href="#projects"
              onClick={(event) => scrollToSection(event, 'projects')}
            >
              检阅项目作品
            </a>
            <button type="button" className="home-btn home-btn-ghost" onClick={handleEnter}>
              进入业务系统
            </button>
          </div>

          <div className="home-metrics">
            {PROFILE.metrics.map((metric) => (
              <div className="home-metric" key={metric.label}>
                <span className="home-metric-value">{metric.value}</span>
                <span className="home-metric-label">{metric.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- 核心能力 ---------------- */}
        <section className="home-section" id="strengths">
          <div className="home-section-head">
            <span className="home-eyebrow">Core Strengths · 核心能力</span>
            <h2 className="home-title">我能把什么事做成</h2>
            <p className="home-desc">
              不是罗列技术名词，而是四件真正交付过、能拿代码和线上系统对上的事。
            </p>
          </div>

          <div className="home-grid home-grid-4">
            {STRENGTHS.map((item) => (
              <article className="home-card" key={item.index}>
                <div className="home-card-head">
                  <span className="home-card-index">{item.index}</span>
                  <span className="home-chip">{item.tag}</span>
                </div>
                <span className="home-card-sub">{item.sub}</span>
                <h3 className="home-card-title">{item.title}</h3>
                <p className="home-card-text">{item.text}</p>
                <ul className="home-card-points">
                  {item.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- 项目作品 ---------------- */}
        <section className="home-section" id="projects">
          <div className="home-section-head">
            <span className="home-eyebrow">Portfolio · 项目作品</span>
            <h2 className="home-title">交付过的系统</h2>
            <p className="home-desc">
              每一个都是真实上线、有用户在用的系统。技术栈和版本号取自工程本身，可以直接对照。
            </p>
          </div>

          <div className="home-filters" role="tablist" aria-label="按类型筛选项目">
            {PROJECT_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={projectFilter === filter.id}
                className={`home-filter${projectFilter === filter.id ? ' is-active' : ''}`}
                onClick={() => setProjectFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="home-grid home-grid-3">
            {visibleProjects.map((project) => (
              <article className="home-card" key={project.id}>
                <span className="home-chip home-card-tag">{project.tag}</span>
                <h3 className="home-card-title">{project.title}</h3>
                <span className="home-card-sub">{project.sub}</span>
                <p className="home-card-text">{project.text}</p>
                <div className="home-chip-row">
                  {project.chips.map((chip) => (
                    <span className="home-chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
                {project.stat && (
                  <div className="home-card-stat">
                    <b>{project.stat.value}</b>
                    <span>{project.stat.label}</span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- 技术栈 ---------------- */}
        <section className="home-section" id="arsenal">
          <div className="home-section-head">
            <span className="home-eyebrow">Tech Arsenal · 技术栈</span>
            <h2 className="home-title">手上在用的工具</h2>
            <p className="home-desc">
              只列真正在项目里写过、调过、踩过坑的技术。百分比是按项目密度估的相对值，
              不代表任何官方口径。
            </p>
          </div>

          <div className="home-skills">
            {SKILLS.map((skill) => (
              <div className="home-skill" key={skill.name}>
                <div className="home-skill-head">
                  <span className="home-skill-name">{skill.name}</span>
                  <span className="home-skill-pct">{skill.level}%</span>
                </div>
                <div className="home-skill-track">
                  <span className="home-skill-fill" style={{ width: `${skill.level}%` }} />
                </div>
                <span className="home-skill-note">{skill.note}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- 职业履历 ---------------- */}
        <section className="home-section" id="journey">
          <div className="home-section-head">
            <span className="home-eyebrow">Journey · 职业履历</span>
            <h2 className="home-title">从业务系统到智能体</h2>
            <p className="home-desc">按技术演进的方向排，越往上越近。</p>
          </div>

          <div className="home-timeline">
            {JOURNEY.map((item) => (
              <div className="home-timeline-item" key={item.period + item.role}>
                <span className="home-timeline-dot" aria-hidden="true" />
                <span className="home-timeline-period">{item.period}</span>
                <h3 className="home-timeline-role">{item.role}</h3>
                <span className="home-timeline-org">{item.org}</span>
                <p className="home-card-text">{item.text}</p>
                <div className="home-chip-row">
                  {item.chips.map((chip) => (
                    <span className="home-chip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- 与我联络 ---------------- */}
        <section className="home-section" id="contact">
          <div className="home-section-head">
            <span className="home-eyebrow">Contact · 与我联络</span>
            <h2 className="home-title">聊聊你的想法</h2>
            <p className="home-desc">
              技术交流、项目合作、或者只是同行打个招呼，都欢迎。
            </p>
          </div>

          <div className="home-contact-grid">
            {CONTACTS.map((contact) => (
              <div className="home-contact-item" key={contact.label}>
                <span className="home-contact-label">{contact.label}</span>
                {contact.href ? (
                  <a
                    className="home-contact-value"
                    href={contact.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {contact.value}
                  </a>
                ) : (
                  <span className="home-contact-value">{contact.value}</span>
                )}
                <p className="home-contact-note">{contact.note}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="home-footer">{FOOTER_TEXT}</footer>

      <LoginModal
        open={loginOpen}
        dark={theme === 'dark'}
        redirectTo={redirectTo}
        onClose={() => setLoginOpen(false)}
      />
    </div>
  )
}
