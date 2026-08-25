---
---

## 设计师黑话速查

本页是设计师日常沟通、评审会议与求职 JD 中常见黑话、术语与潜台词的速查表，按 9 个主题分类整理，共收录 160+ 条。**黑话 ≠ 能力**；「老板与同事潜台词」一节多为调侃与夸张，请谨慎对号入座。

PM 侧的黑话见[产品经理黑话速查](../intro/glossary.md)；设计方法论的完整展开见[产品设计与原型总览](design.md)。

???+ note "提示"
    组件类术语的规范定义以 **Material Design 3**（m3.material.io）与 **Apple HIG**（Human Interface Guidelines）官方文档为准。

    本页为速查摘要，细节与最新版本以官方页面为准（整理日期 2026-08-24）。

### 角色与组织

设计师岗位与分工的术语，面试与 JD 中高频出现。

| 黑话 | 含义 |
| --- | --- |
| UX | User Experience，用户体验；也指用户体验设计师（UX Designer）。UX 是领域总称，不是「画图的」 |
| UI | User Interface，用户界面；也指界面设计师。UI 管「长什么样」，交互管「怎么用」 |
| UE | User Experience，用户体验的早期叫法，与 UX 同义，老 JD 里常见 |
| UED | User Experience Design，用户体验设计，通常指设计团队/部门 |
| IXD | Interaction Design，交互设计：设计用户与产品的交互行为与反馈，产出流程图、状态与原型 |
| VD / VX | Visual Design，视觉设计：配色、图标、排版、质感等界面视觉表现 |
| UCD | User-Centered Design，以用户为中心的设计，一套设计方法论（不是岗位，常与「UCD 流程」搭配使用） |
| UER | User Experience Researcher，用户研究员：做访谈、可用性测试、数据分析，产出洞察 |
| DesignOps | Design Operations，设计运营：搭设计流程、工具链与协作机制，让设计师专注设计本身 |
| Design Lead | 设计负责人：带团队、定设计方向、主持评审、对设计质量负责 |
| 设计系统设计师 | Design System Designer，专门维护组件库、规范与令牌的岗位 |
| Growth Design | 增长设计：以转化、留存等业务指标为目标的数据驱动设计 |
| UX Writer | 用户体验文案师：专门负责界面文案与微文案（Microcopy），让「话」和「视觉」一样被设计 |
| Product Designer | 产品设计师：兼具 UX/UI 能力、独立负责完整功能设计的岗位，国外 JD 主流叫法 |
| Full-stack Designer | 全栈设计师：UX、UI、交互、前端样样都做（初创公司最爱写） |
| Research Ops | 研究运营：维护用户研究的基础设施（招募池、工具、流程），与 DesignOps 对应 |

### 方法与流程

从用户研究到设计交付的常用方法；评审时说得上名字、背得出产出，比「感觉」更有说服力。方法论背景见[设计哲学与设计思维](design-philosophy.md)。

| 黑话 | 含义 |
| --- | --- |
| Design Thinking | 设计思维：以用户为中心的创新方法论，经典五步——同理心 → 定义 → 构思 → 原型 → 测试 |
| Double Diamond | 双钻模型：两轮「发散-收敛」：先发散找对问题、再收敛定方案，重复一轮 |
| UCD 流程 | 以用户为中心的设计流程：用户研究 → 方案设计 → 原型评估 → 迭代，循环推进 |
| Persona | 用户画像（人物角色）：基于研究数据提炼的目标用户典型形象，含目标、痛点、行为习惯 |
| User Journey Map | 用户旅程图：用户从发现、使用到离开的全流程体验地图，标注每个环节的感受与机会点 |
| Service Blueprint | 服务蓝图：在旅程图基础上补充前台触点、后台流程与支撑系统，常用于跨部门服务设计 |
| User Flow | 用户流程：用户为完成任务经历的步骤序列（页面/动作级别） |
| Task Flow | 任务流：聚焦单个任务的更细步骤，通常比 User Flow 更接近具体操作 |
| Storyboard | 故事板：用连环画式的分镜描述用户使用场景，帮助团队对齐「在什么情境下用」 |
| Scenario | 场景：用户使用产品的具体情境描述，写清人物、目标、环境 |
| Wireframe | 线框图：用线条与灰块框出页面结构与布局，不讲究视觉，用于快速对齐框架 |
| Mockup | 视觉稿：带完整视觉表现的高保真静态稿，通常不包含交互 |
| Prototype | 原型：可交互的页面示意稿，用于验证流程与体验；工具与保真度取舍见[原型与设计交付](design-prototyping.md) |
| Low-fi / Hi-fi | 低保真 / 高保真：原型的精细度两档：低保真验证结构与流程，高保真验证视觉与细节 |
| Clickable Prototype | 可点击原型：带跳转与反馈的可交互原型，可用性测试常用 |
| IA | Information Architecture，信息架构：信息的组织、导航与命名方式，决定用户找不找得到东西 |
| Card Sorting | 卡片分类：让用户把写有内容的卡片分组，得出用户心里的信息组织方式（分开放/封闭两种） |
| Tree Testing | 树测试：只给导航层级文字，让用户找目标位置，检验 IA 是否合理 |
| Heuristic Evaluation | 启发式评估：专家按可用性原则清单（如 Nielsen 十大原则）逐页检查问题 |
| Cognitive Walkthrough | 认知走查：专家模拟用户的认知过程逐步走任务，找「用户会不会卡住」的地方 |
| Usability Test | 可用性测试：让真实用户执行任务，观察与记录他们怎么卡住；执行细节见[设计评审与可用性度量](design-evaluation.md) |
| Think Aloud | 出声思维：可用性测试中让用户边操作边说想法，暴露内心判断 |
| A/B Test | A/B 测试：给不同用户看不同版本，用数据决定哪个更好 |
| Design Critique | 设计评审：团队对设计方案的批判性讨论，重「提问与迭代」，不是汇报会 |
| Design Review | 设计走查 / 评审会：与 Critique 常混用；严格区分时 Review 更偏「向决策者汇报方案」 |
| Handoff | 设计交接：把设计稿、标注与规范交付给开发的环节，交接质量直接影响还原度 |
| Design Spec | 设计规格说明：精确描述组件尺寸、间距、字号、行为与状态，是开发的实现依据 |
| Design Token | 设计令牌：把颜色、字号、间距等设计决策存为平台无关的命名变量（如 color.primary），供多端复用 |
| Style Guide | 风格指南：品牌与视觉规范的说明文档（Logo、色板、字体、栅格） |
| Pattern Library | 模式库：可复用的交互模式集合（何时用下拉、何时用对话框） |
| Component Library | 组件库：可复用 UI 组件的实现集合，偏代码层面（如 React 组件） |
| Design System | 设计系统：组件库 + 设计令牌 + 规范文档 + 工具与治理的完整体系，详见[设计系统与规范](design-systems.md) |
| Design Debt | 设计债：为赶进度欠下的一致性/体验债，越积越多后需要专门偿还 |
| Refactor | 设计重构：在不改变功能与行为的前提下重做设计实现，消除设计债 |

### 组件术语（Material Design / HIG 为主）

评审与开发对接时的组件词汇。括号内标注所属体系：MD = Material Design，HIG = Apple HIG，通用 = 跨平台通用叫法。

| 黑话 | 含义 |
| --- | --- |
| FAB | Floating Action Button，悬浮操作按钮：Material Design 的强调性主操作入口，通常为 56dp 圆形按钮；MD3 推荐带文字标签的 Extended FAB（MD） |
| Bottom Sheet | 底部弹层：从屏幕底部滑出的面板，承载补充操作或详情；HIG 对应 Sheet（如操作列表 Action Sheet）（MD / HIG） |
| Snackbar | 轻提示条：短暂出现的消息条，可带操作按钮（如「撤销」）、可滑动关闭；MD3 官方建议替代 Toast（MD） |
| Toast | 轻提示：纯信息、自动消失、不可操作；Android 原生 Toast 仍广泛存在，但 Android 12+ 官方更推荐 Snackbar（Android / 通用） |
| Dialog | 对话框：居中弹窗容器，承载确认、输入等短任务；可分为模态与非模态（MD / 通用） |
| Modal | 模态：阻止用户与页面其余部分交互的「打断模式」，Dialog 常被做成模态；HIG 的 Alert、MD3 的 Modal Dialog 均为模态（HIG / MD） |
| Alert / Banner | 警报 / 横幅：HIG 的 Alert 是系统级模态警告框；Banner 是页面内不打断操作的横条提示，可手动关闭（HIG / 通用） |
| Tooltip | 工具提示：悬停或聚焦时出现的简短文字说明，不承载操作（通用） |
| Popover | 气泡卡片：点击触发的小型浮层，可承载少量内容与操作，比 Tooltip 内容多、可交互（MD / 通用） |
| Chips | 标签块：MD 的小型信息块，用于筛选（Filter）、输入（Input）、触发操作等场景（MD） |
| Segmented Control | 分段控件：并列互斥的选项切换，默认选中一项；Material 对应 Segmented Button（HIG） |
| Stepper | 步骤条：分步流程的进度指示（第 1 步/第 2 步…）；注意英文 Stepper 也可指「数字步进器」，中文语境多指步骤条（MD / 通用） |
| Tabs | 标签页：同级内容的切换容器，顶部或底部（MD / HIG / 通用） |
| Carousel | 轮播：横向滑动展示多张内容，电商 Banner 常客（通用） |
| Accordion | 手风琴：可折叠面板组，展开一项时收起其他项，适合层级信息（通用） |
| Drawer / Nav Drawer | 抽屉 / 导航抽屉：从屏幕侧边滑出的面板，常承载导航（汉堡菜单）；HIG 无原生对应，MD 的 Modal/Standard Drawer 常用（MD） |
| App Bar / Top App Bar | 应用栏 / 顶部应用栏：MD 的页面顶部栏，承载标题、操作与导航；HIG 对应 Navigation Bar / Toolbar（MD / HIG） |
| Status Bar / Navigation Bar | 状态栏：手机顶部系统信息区（时间、电量）；Navigation Bar 有歧义：HIG 指底部导航栏（对应 Material 的 Bottom Navigation），Android 系统语境则指底部手势/按键条（通用） |
| Avatar | 头像：用户或实体的圆形/方形头像（MD / 通用） |
| Badge | 角标：附着在图标上的小标记，显示未读数、新消息等（MD / HIG） |
| Switch | 开关：二态切换控件，即时生效（MD / HIG） |
| Slider | 滑块：在区间内选择数值的控件，可配合步进值（MD / HIG） |
| Progress Indicator | 进度指示器：加载与进度反馈，分「确定（有百分比）」与「不确定（转圈）」两种（MD / HIG） |
| Skeleton Screen | 骨架屏：内容加载前先显示结构占位（灰色块），减少「白屏焦虑」（通用） |
| Shimmer | 微光：骨架屏上流动的渐变高光效果，表示「正在加载」（通用） |
| Pull-to-refresh | 下拉刷新：移动端下拉手势触发刷新（通用） |
| Empty State | 空状态：列表/内容为空时的引导界面，好的空状态给出下一步行动（通用） |
| Floating Panel | 浮动面板：悬浮于内容之上的可拖拽面板，视频会议、AI 助手常客（通用） |
| Command Palette | 命令面板：快捷键（如 ⌘K）唤起的搜索式命令入口，可执行任意操作（Figma、Notion、Linear 都有）（通用） |
| Pill | 胶囊：圆角极大的胶囊形按钮/标签，常与 Chip 混用（通用） |
| Tag | 标签：内容上的分类标记，通常不可交互；可交互时称为 Chip（通用） |
| Timeline | 时间线：按时间顺序展示事件的列表（动态、订单轨迹）（通用） |
| Dropdown | 下拉：点击展开的选项列表，用于选择或导航（MD / HIG / 通用） |
| Breadcrumb | 面包屑：展示层级路径的次级导航，方便返回上级（通用） |
| Pagination | 分页：把内容分成多页加载，适合可跳转的场景（通用） |
| Infinite Scroll | 无限滚动：滚动到底自动加载更多，信息流标配；牺牲了「定位与页脚」（通用） |
| Toast vs Snackbar | Toast 与 Snackbar 的区别：Toast 纯提示不可操作；Snackbar 可带操作按钮、可滑动关闭、可等到用户处理；Material 官方推荐 Snackbar |

### 视觉与排版

界面「长得怎么样」的术语，评审中最常被提到的维度。基础展开见[视觉设计基础](design-visual.md)。

| 黑话 | 含义 |
| --- | --- |
| Grid | 栅格：把页面宽度分成等宽列，元素按列对齐，保证多屏一致性（通用） |
| 12 列栅格 | 12 列栅格：响应式布局的经典分栏（Bootstrap 等），12 能被 2/3/4/6 整除，组合灵活（通用） |
| 8pt Grid | 8pt 栅格：间距与尺寸以 8 的倍数取值，保证节奏一致；MD 的间距实际以 4 为基础（MD / 通用） |
| Baseline Grid | 基线栅格：让文字按同一基线对齐的排版网格（排版） |
| Spacing Scale | 间距阶梯：预定义的间距值序列（如 4/8/12/16/24），避免随手写数字（通用） |
| Type Scale | 字号阶梯：预定义的字体大小/字重序列，保证层级清晰（通用） |
| Hierarchy | 视觉层级：通过大小、粗细、颜色让内容主次分明，用户一眼抓住重点（通用） |
| Contrast | 对比度：前景与背景的亮度差异，正文至少 4.5:1（WCAG AA）（通用） |
| Kerning | 字偶距：两个相邻字符之间的间距微调，标题排版常用（排版） |
| Tracking | 字距：整段文字的统一定距，与 Kerning 相对（排版） |
| Leading | 行距：相邻文本行基线之间的距离（排版） |
| Serif / Sans-serif | 衬线 / 无衬线：衬线体（宋体、Times）笔画末端有装饰；无衬线体（黑体、Helvetica）更简洁，屏幕 UI 常用（排版） |
| Tabular Numbers | 等宽数字：每个数字宽度一致，表格、倒计时、价格跳动场景必用（排版） |
| Breakpoint | 断点：布局切换的屏幕宽度阈值，如 768px/1024px，是响应式设计的基础（通用） |
| Responsive / Adaptive | 响应式 / 自适应：响应式靠流式布局与媒体查询「随窗口伸缩」；自适应是为不同尺寸准备多套固定布局（通用） |
| Dark Mode | 深色模式：深色背景配色方案，需单独设计层级与对比度，不是简单「反色」（通用） |
| Glassmorphism | 玻璃拟态：半透明 + 背景模糊 + 细边框高光的「毛玻璃」风格，2021 年前后流行（风格） |
| Neumorphism | 新拟态：同色系的浮雕效果（亮部+暗部），观感柔和但对比度低、可访问性差，流行一阵后式微（风格） |
| Skeuomorphism | 拟物：让界面模仿真实物体（皮质纹理、3D 按钮），iOS 早期风格（风格） |
| Flat Design | 扁平化：去掉质感与阴影，用纯色块与简洁图形，与拟物相对（风格） |
| Material You | Material 动态取色：Android 12+ 起 Material Design 的个性化形态，从壁纸提取颜色生成主题（MD） |
| Elevation | 高度 / 层级：MD 用阴影与表面色表示元素在 z 轴的「高度」，MD3 用 Surface Tint 表达（MD） |
| Shadow | 阴影：表达层级与深度的常用手段，注意阴影也有性能成本（通用） |
| Border Radius | 圆角：元素四角的弧度，圆角大小影响气质（锋利/亲和）（通用） |
| Color Role | 色彩角色：设计系统里颜色的职能命名（primary、secondary、surface、error 等），不直接叫「蓝色」（MD / 通用） |
| Tonal Palette | 色调色板：一个色相衍生的 10 个色调深浅序列，MD3 用它生成主题（MD） |
| Brand Color / Accent Color | 品牌色 / 强调色：品牌识别色 / 用于关键操作与高亮的点缀色（通用） |

### 动效与交互

「手感」与「反馈」的术语，交互细节见[交互设计基础](design-interaction.md)。

| 黑话 | 含义 |
| --- | --- |
| Micro-interaction | 微交互：单个操作的细节反馈（点赞的跳动、开关的滑动），是「手感」的来源 |
| Easing | 缓动：动画的速度变化曲线（ease-in/out、cubic-bezier），决定动画是「顺滑」还是「生硬」 |
| Spring | 弹簧动画：模拟物理回弹的动画（如 iOS 的弹簧效果），比线性动画自然 |
| 60fps | 每秒 60 帧：动画流畅的行业标准，低于 30fps 会明显卡顿；高刷屏（120Hz）则要更高帧率 |
| Stagger | 错峰动画：多个元素依次错开入场，比同时出现更有节奏 |
| Parallax | 视差：滚动时背景比前景移动更慢，营造空间感 |
| Motion Design | 动效设计：把动效当设计语言统一设计（时长、缓动、语义），而非零散加特效 |
| Haptics | 触感反馈：震动马达的物理反馈（如 iPhone 的 Taptic Engine），增强操作确认感 |
| Gesture | 手势：点击、长按、滑动、捏合、多指等非鼠标操作方式，移动端交互基础 |
| Touch Target | 触控目标：可点击区域的最小尺寸，HIG 建议 44×44pt，MD 建议 48×48dp；太小伤可用性 |
| Hover / Focus / Active | 悬停 / 聚焦 / 激活：控件的三种状态反馈：鼠标悬停、键盘聚焦、按下激活，缺一不可 |
| Optimistic UI | 乐观 UI：先立刻显示预期结果（如「已发送」），后台再确认；体验流畅但要在失败时回滚 |
| Debounce / Throttle | 防抖 / 节流：防抖 = 停止触发后执行一次；节流 = 固定频率执行；搜索联想、滚动加载的标配 |

### 可访问性

无障碍术语，评审中常被忽略但极易翻车。原则展开见[交互设计基础](design-interaction.md)的可访问性小节。

| 黑话 | 含义 |
| --- | --- |
| WCAG | Web Content Accessibility Guidelines，Web 内容无障碍指南，国际公认的可访问性规范（当前版本 2.2） |
| ARIA | Accessible Rich Internet Applications，WAI-ARIA：给读屏软件提供语义的 HTML 扩展（角色、状态、属性） |
| AA / AAA | WCAG 的两个合规级别：AA 是基本要求（正文对比度 4.5:1），AAA 是增强要求（7:1） |
| Screen Reader | 读屏软件：把界面朗读给视障用户的辅助技术，如 VoiceOver（iOS）、TalkBack（Android）、NVDA（Windows） |
| Focus Ring | 焦点环：键盘导航时高亮当前焦点元素的可见边框；可以美化样式，但不能移除 |
| Color Blind | 色盲：约 8% 男性有红绿色觉缺陷，设计不能只靠颜色传达信息（用图标/文字辅助） |
| Reduced Motion | 减弱动效：响应 prefers-reduced-motion 媒体查询，关闭大幅动效与闪烁，避免诱发不适 |
| Keyboard Navigation | 键盘导航：所有功能都能用 Tab/方向键/回车完成，是 Web 可访问性的底线 |
| Contrast Ratio | 对比度比率：前景/背景亮度的比率，正文 ≥ 4.5:1（AA）、大字号 ≥ 3:1 |

### AI 设计

AI 时代的新黑话，更新极快，以官方页面为准。

| 黑话 | 含义 |
| --- | --- |
| Prompt-to-UI | 提示词生成界面：用自然语言描述需求直接生成界面初稿，设计师从「画」变为「改」 |
| Generative UI | 生成式界面：界面根据上下文动态生成（如 AI 助手自动组织操作按钮），而非静态设计稿 |
| AI 设计工具 | Figma AI、v0（Vercel）、Motiff、Anima、Relume 等：覆盖生成界面、生成组件、设计稿转代码；工具迭代极快，以官方页面为准 |
| Design-to-Code | 设计稿转代码：从设计稿直接产出可用前端代码，曾是「玄学」，如今是 AI 的常规能力 |
| Greenfield / Redesign | 从零设计 / 重设计：对 AI 而言，Greenfield（新项目）更适合生成式方案；Redesign 约束多（品牌、兼容、迁移），AI 更多做局部建议与批量重构 |
| Vibe Coding | 灵感编程：用自然语言让 AI 写代码，设计师也能快速做出可交互 demo 验证想法 |

### 工具与协作

工具术语，选型与交付细节见[原型与设计交付](design-prototyping.md)。

| 黑话 | 含义 |
| --- | --- |
| Figma | 界面设计与协作工具的事实标准：核心概念有 Frame（画板）、Auto Layout（自动布局）、Variants（组件变体）、Libraries（共享组件库）、Dev Mode（开发标注） |
| Sketch | macOS 上的老牌界面设计工具，曾统治 UI 设计，如今生态被 Figma 超越 |
| Adobe XD | Adobe 的界面设计工具，官方已停止更新并建议迁移到 Figma |
| FigJam | Figma 的白板协作工具：流程图、头脑风暴、复盘会常用 |
| Zeplin | 设计标注与交付工具：从设计稿导出标注给开发看 |
| Tokens Studio | Figma 的 Design Token 管理插件，与代码侧令牌同步 |
| Style Dictionary | Amazon 开源的设计令牌编译工具：把 tokens 编译成各平台代码（CSS、Swift、XML 等） |
| Framer | 交互原型与建站工具，近年主打 AI 生成网站 |
| ProtoPie | 高保真交互原型工具：支持传感器、多屏联动等复杂交互 |
| 墨刀 | 国内老牌原型工具：快速线框与演示，适合国内团队协作 |
| MasterGo | 蓝湖出品的国内协作设计工具：云端协作、组件库，支持导入 Figma 文件 |
| Penpot | 开源免费的 Figma 替代品：适合在意数据自主权的团队 |

### 老板与同事潜台词

仿[产品经理黑话速查](../intro/glossary.md)的调侃节，多为夸张演绎，请勿对号入座。

| 黑话（表面说法） | 真实含义 |
| --- | --- |
| 像素级还原 | 视觉完美主义的验收标准：开发还原度要和设计稿一模一样（往往还要免费修细节） |
| 再打磨打磨 | 说不清哪里不好，反正不满意；最省事的做法是准备 2~3 个方向让老板选 |
| 先上线再说 | 设计让步：细节没定稿也要按期上线，体验问题之后补 |
| 这个交互很顺滑 | 用了默认缓动曲线（不一定是夸你，可能只是没自定义） |
| 感觉差点意思 | 重画吧：没有具体意见，但方向不对 |
| 五彩斑斓的黑 | 经典梗：要求「既是黑的又要五彩斑斓」——不存在的颜色需求 |
| 大气 | 说不清的需求：想要「高级、稳重、有气势」，参考对象往往是大厂官网 |
| 科技感 | 蓝紫色渐变 + 光效 + 暗色底（2026 年 AI 时代依然好用） |
| 留白再多一点 | 信息密度降低：元素变小、间距变大，而不是「真的加白块」 |
| 把 logo 放大 | 经典梗：老板对设计唯一的具象要求 |
| 高级感 | 通常等于「极简 + 大留白 + 克制配色」，参考对象：苹果 |
| 有点平 | 缺乏层级：加点阴影、对比或动效，让元素「立」起来 |

## 来源说明

> 以下来源均为官方文档或权威机构，以最新版本为准；整理日期 2026-08-24。

-   [Material Design 3](https://m3.material.io)（组件、色彩、动效与 Design Tokens 官方规范）
-   [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)（iOS/iPadOS 组件与交互规范）
-   [Ant Design](https://ant.design)（国内企业级组件规范，Web 场景常用）
-   [Nielsen Norman Group](https://www.nngroup.com)（启发式评估、可用性测试等方法论权威）
-   [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)（可访问性规范）
-   [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/)（无障碍语义规范）
-   [Figma 帮助中心](https://help.figma.com)（Auto Layout、Variants 等工具术语）
-   [Style Dictionary](https://amzn.github.io/style-dictionary/)（设计令牌编译工具）
