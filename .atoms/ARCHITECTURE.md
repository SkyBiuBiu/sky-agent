---
last_updated: 2026-10-09T10:30:00Z
---

# Architecture Design

## System Overview
React SPA（标签页：工作台/角色/历史/模型配置）→ web-sdk → FastAPI（Atoms Cloud）→ 用户配置的 OpenAI 兼容 /chat/completions 接口。持久化数据存放在 PostgreSQL 中。

## Tech Stack
Vite + React + TS + shadcn/ui + markdown-to-jsx + jszip；FastAPI + SQLAlchemy async + httpx。

## Module Design
| Module | Responsibility | Key Files |
|--------|---------------|-----------|
| 编排服务 | 默认角色、LLM 调用与错误映射（401/429/超时）、提示词构建、按 `### FILE:` 解析产物 | app/backend/services/sky.py |
| Sky API | config 读写/测试、创建项目、执行单步、结束项目 | app/backend/routers/sky.py |
| 数据表 | llm_configs、agent_roles、projects、pool_messages、artifacts | app/backend/models/* |
| 工作台 | SOP 流水线、逐字展示、错误重试、token 统计 | src/components/sky/Workbench.tsx |
| 面板 | 消息池时间线、产物文件树、单文件/ZIP 下载 | src/components/sky/Panels.tsx |
| 设置 | 模型配置、角色 CRUD、项目历史 | src/components/sky/Settings.tsx |

## Tech Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| 发布/订阅 | 消息含 msg_type；角色只读取 subscribe_types 中包含的类型；subscribers 字段记录订阅该类型的角色 | 对应发布/订阅的 watch / publish 机制 |
| 下载 | 浏览器端 Blob + JSZip | 无需对象存储 |

## File Tree Plan
app/backend/{services,routers}/sky.py；app/frontend/src/lib/sky.ts；src/components/sky/*；src/pages/Index.tsx

## Implementation Guide
API：GET/POST /api/v1/sky/config、POST /config/test、GET /roles/init、POST /projects、POST /projects/{id}/step {role_id}、POST /projects/{id}/finish。
