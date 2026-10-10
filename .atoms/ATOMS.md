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

## Constraints
- 不使用平台内置模型，也不通过 SecretManager 收集 Key。
- 使用 Atoms 登录体系；所有数据按 user_id 隔离。
