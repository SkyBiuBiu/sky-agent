# Sky Agent Design

## Direction & Layout
- 面向开发者的多 Agent 协同工作台，冷静、专业、信息密度中高；首屏信号是「SOP 流水线」：产品经理 → 架构师 → 工程师 节点条，当前运行节点高亮。
- 首屏以 SOP 流水线示意条为核心信号（产品经理 → 架构师 → 工程师），不做营销落地页风格。
- 布局：顶部 56px 导航（Logo + 标签页：工作台/角色/历史/模型配置 + 登录按钮）；工作台为 3 栏：左 300px 需求与 SOP，中间消息池时间线（弹性），右 44% 产物面板。<1024px 时纵向堆叠。最大宽度 1600px，间距 16px。
- 禁止：蓝紫渐变、发光卡片、彩色左边框卡片。

## Tokens
- 颜色沿用 index.css 语义变量（background / card / primary / muted / border / destructive）。消息类型色：UserRequirement 灰、PRD 琥珀 #b45309、SystemDesign 青 #0f766e、Code 靛 #4338ca，仅用于小徽章。
- 字体：系统 sans；代码与 token 数用 monospace。标题 18/600，正文 14/1.6，说明 12。
- 圆角：卡片 8px，按钮/输入 6px，徽章 999px。阴影仅 shadow-sm，层级以 1px border 区分。

## Shared Patterns & States
- 消息卡片：头部 发布者 + 类型徽章 + 订阅者 + token 数；正文 Markdown，可折叠。
- 运行中：节点脉冲点 + 逐字输出；错误：destructive 提示条含原因（Key 无效/超时/限流）与重试按钮。
- 空态：引导文字 + 主要动作。焦点环使用 ring 变量，按钮最小 36px 高。
- 动效 150ms ease-out，仅用于状态切换。

## Media
- 操作型工具界面，不需要图片；用 lucide 图标表示角色。
