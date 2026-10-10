---
last_updated: 2026-10-09T10:30:00Z
status: active
---

# Project Context

## Project Overview
Sky Agent：多 Agent 协同站点（类 Atoms）。角色按 SOP 顺序（产品经理 PRD → 架构师 设计 → 工程师 代码）协作，通过共享消息池发布/订阅消息，产出可下载的产物。使用用户自己的 OpenAI 兼容 API Key。

## Key Decisions
| Date | Decision | By | Rationale |
|------|----------|-----|-----------|
| 2026-10-09 | Atoms Cloud 后端 + 每个角色调用一次 /step 接口，前端按 SOP 顺序依次调用 | Alex | 避免单次请求过长，失败后可从当前步骤重试 |
| 2026-10-09 | 「流式」由前端逐字展示每一步的结果实现；token 用量来自 usage 字段 | Alex | 适配 Lambda 的请求/响应模型 |
| 2026-10-09 | 删除 llm_configs 自动生成的 CRUD 路由，只通过 /api/v1/sky/config 访问并返回脱敏 Key | Alex | Key 不得暴露、不得写入日志 |
| 2026-10-09 | 新用户首次使用时，自动在 agent_roles 中写入 Emma、Bob、Alex 三个默认角色 | Alex | 角色可自定义，且按用户隔离 |
| 2026-10-09 | 解析模型回复时兼容 content / reasoning_content / reasoning 字段 | Alex | SenseNova 等推理模型只在 reasoning 中返回内容，原解析为空导致 500→网关 502 |
| 2026-10-09 | 请求体固定带 `thinking:{type:disabled}`，遇 400 自动去掉重试 | Alex | 推理模型会把输出预算全部用于隐藏思考，导致正文被截断 |
| 2026-10-09 | 连通性测试先 GET /models 匹配模型名，未命中时再发 max_tokens=1 的最小对话；连接超时 5s，总超时 10s；前端缓存 60s 内的成功结果 | Alex | 实测从约 2-20s 降到约 0.5s，避免 524 |
| 2026-10-09 | 每步限制输出：文档 3500 / 代码 6000 token，单步超时 85s（低于网关约 100s 的上限） | Alex | 避免长请求触发 524；超时返回结构化错误，可从失败步骤重试 |
| 2026-10-09 | 项目即持久会话：projects.current_version，消息与产物带 version；/iterate 开新版本，角色以自己上一版产出和对话历史为上下文做增量修改 | Alex | 支持对话式迭代和版本切换 |
| 2026-10-09 | 中断：/cancel 把状态置为 interrupted；/step 每 1.5s 轮询状态并取消上游 httpx 任务，前端同时 abort 请求并停止后续步骤 | Alex | 后端真正取消执行，已生成内容保留 |
| 2026-10-09 | 工程师默认只输出单文件 index.html（内联 CSS/JS），产物面板支持 iframe 预览 | Alex | 多文件工程会被 6000 token 截断，单文件可直接查看 |
| 2026-10-09 | 预览链路：解析兼容 FILE 标记、普通代码块、未闭合代码块和裸 HTML；自动补齐 index.html 并闭合截断的标签；check_preview 自检后，前端调用 /repair 让工程师修复一次；前端内联本地 css/js，并注入错误钩子通过 postMessage 回传运行时错误 | Alex | 保证产物可预览，不出现空白页 |
| 2026-10-09 | 工作区 `.git` 是只读挂载（gitdir 指向 /run/gitdata，索引不可写），改为在 /tmp 导出干净副本后 git init 并推送 | Alex | 避免修改被平台托管的仓库状态 |
| 2026-10-09 | 代码产物解析增加兜底：FILE 标记 → 代码块（含未闭合）→ 原文 | Alex | 模型不一定遵守 FILE 格式，截断时也要能下载 |
| 2026-10-09 | README 拆分为锚点目录 / 快速开始 / 功能一览（配图）/ 目录结构 / 模型配置 / 使用流程 / 环境变量 / 常见问题 / 安全说明，图片放在 docs/images 并以相对路径引用 | Alex | 文档需可导航，且图片需随仓库分发 |
| 2026-10-09 | 全仓库清除对第三方多 Agent 框架的借鉴类表述，改为中性描述（README 简介、首屏文案、meta description、后端注释、上下文文件） | Alex | 避免把项目描述为对第三方项目的模仿；被删处均补中性文案，不留空标题 |
| 2026-10-09 | 账号体系：新增 app_accounts 表（PBKDF2-SHA256 加盐哈希），注册/登录/改密签发与平台同格式的应用 JWT，前端写入 localStorage 的 `token` 键 | Alex | 复用 SDK 既有的 Bearer 注入通道，无需改动任何既有 `/api/v1/*` 接口；登录方式完全由站点自控 |
| 2026-10-09 | 删除自动生成的 /api/v1/entities/app_accounts 路由 | Alex | 该路由无鉴权且会返回 password_hash，账号数据不得对外暴露 |
| 2026-10-09 | 演示账号 demo/demo123 固定在 account_id=sky-demo-account；只读守卫放在 get_current_user 依赖中（放行 /api/v1/sky/accounts/*） | Alex | 一处拦截即可覆盖所有写接口（含自动生成的实体路由），不给演示数据被覆盖留后门 |
| 2026-10-09 | 演示账号预置 3 个已完成项目（待办清单、计算器含暗色模式、咖啡店落地页）及各自 PRD/设计/代码产物与协作消息 | Alex | 访客登录后立刻看到完整效果，不是空列表；仅在演示账号没有项目时才播种 |

| 2026-10-10 | 预设角色存为全局只读模板（agent_roles.user_id=`__system_template__`），用户角色单独按 user_id 存储；新用户不再复制种子；/api/v1/sky/roles 返回 templates/mine/default_ids，/roles/{id}/copy 复制模板；建项目/迭代可传 role_ids，后端校验只能用模板或本人角色；同名时本人角色覆盖模板 | Alex | 修复越权并分离模板与自建角色 |
| 2026-10-10 | 删除 agent_roles/projects/pool_messages/artifacts 四个无鉴权的 `/all` 路由 | Alex | 这些接口会返回所有账号的数据 |
| 2026-10-10 | 拖拽排序不新增 sort_order 字段，直接重排「我的角色」已有的 sop_order 值（保持原有位置集合） | Alex | 显示顺序即执行顺序，避免两套顺序不一致 |
| 2026-10-10 | 取消全局预设模板，角色全部为用户自有副本；默认 4 角色（产品经理→架构师→工程师→QA工程师）在注册/演示登录时幂等写入（按名称去重）；sop_order 每次读取归一为 1..n，拖拽直接写入 1..n | Alex | 用户要求只保留「我的角色」，显示顺序与执行顺序一致（取代此前模板相关决策） |
| 2026-10-10 | 工作台与历史合并为单页（会话栏+工作区），执行顺序唯一来源为「我的角色」；每次运行写入 run_plans 快照，回看按快照显示；旧示例会话无快照时按消息发送者推断 | Alex | 回看不随之后角色调整变化 |

| 预览 iframe 不加 allow-same-origin，改为 srcdoc 注入内存 Storage 垫片 | 保持沙箱隔离，避免存储访问白屏 |

| 在 /tmp 克隆仓库后同步工作区文件推送；令牌只在命令行临时使用 | 平台 git 目录只读；避免强推和凭证落盘 |

## Constraints
- 不使用平台内置模型，也不通过 SecretManager 收集 Key。
- 使用 Atoms 登录体系；所有数据按 user_id 隔离。
