# Sky Agent

Sky Agent 是一个多 Agent 协同站点：把一句需求交给一支虚拟软件团队，由「我的角色」中的产品经理、架构师、工程师、QA工程师通过共享消息池发布、订阅消息，依次协作，最终产出 PRD、系统设计、可直接运行的网页代码和测试报告。

模型调用使用用户自己填写的 OpenAI 兼容接口，不依赖平台内置模型。

## 目录

- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [目录结构](#目录结构)
- [模型配置](#模型配置)
- [使用流程](#使用流程)
- [环境变量](#环境变量)
- [常见问题](#常见问题)
- [安全说明](#安全说明)

## 功能一览

### 1. 账号

支持邮箱注册、登录、修改密码。演示账号 `demo` / `demo123` 可在登录页一键登录，演示账号为只读，无法执行写操作。

![登录页](docs/images/login.png)

### 2. 工作台（会话栏 + 工作区）

左侧是会话栏，支持搜索、按时间分组和删除会话；右侧是当前会话的工作区。顶部的执行进度条只读展示，执行顺序以「我的角色」中的排序为准。

![工作台](docs/images/workbench.png)

### 3. 对话式迭代与共享消息池

各角色的产出按时间线显示在共享消息池中。可以继续发消息迭代（例如「增加暗色模式」）生成新版本；运行中可随时中断任务，后端会真正取消正在进行的模型请求。

![消息池](docs/images/message-pool.png)

### 4. 产物预览、版本切换与下载

生成的网页在沙箱 iframe 中预览。预览环境兼容本地存储：localStorage / sessionStorage 不可用时自动降级为内存存储，不会白屏。可在不同版本之间切换，也可下载单个文件或 ZIP；下载内容为原始产物，不含预览注入脚本。

![产物预览](docs/images/artifact-preview.png)

### 5. 我的角色

新账号默认有产品经理、架构师、工程师、QA工程师 4 个角色。页面左右分栏：左侧角色列表可拖拽调整执行顺序，右侧编辑角色详情。新建角色时显示空白表单，保存后才会创建。

![我的角色](docs/images/custom-roles.png)

### 6. 模型配置

填写 OpenAI 兼容接口的 Base URL、模型名和 API Key，并可进行连通性测试。API Key 仅保存在服务端，展示时脱敏。

![模型配置](docs/images/model-config.png)

## 快速开始

### 方式一：一键启动脚本（推荐）

```bash
cd app
bash start_app_v2.sh
```

### 方式二：分别启动前后端

```bash
# 后端
cd app/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端（另开一个终端）
cd app/frontend
pnpm install
pnpm run dev
```

### 构建校验

```bash
cd app/frontend
pnpm run lint
pnpm run build
```

> 数据库、登录、对象存储等能力由 Atoms Cloud 平台注入，本地运行需要平台提供的后端环境变量。

## 目录结构

```
.
├── README.md
├── .gitignore
├── docs/images                   # README 使用的真实界面截图
├── app
│   ├── start_app_v2.sh           # 本地启动脚本
│   ├── backend                   # 后端（FastAPI + Atoms Cloud）
│   │   ├── routers/sky.py        # Sky Agent 核心接口
│   │   ├── services/sky.py       # 角色编排、模型调用与产物解析
│   │   └── services/accounts.py  # 账号与演示数据
│   └── frontend                  # 前端（Vite + React + TypeScript + shadcn/ui）
│       └── src
│           ├── components/sky/   # 工作台、消息池、产物面板、角色、配置
│           ├── lib/sky.ts        # 数据访问、预览组装（含存储兼容垫片）与下载
│           └── pages/Index.tsx   # 主页面
└── .atoms                        # 项目上下文（决策、进度、架构）
```

## 模型配置

| 配置项 | 说明 | 示例（占位符） |
| --- | --- | --- |
| Base URL | OpenAI 兼容接口地址，通常以 `/v1` 结尾 | `https://api.example.com/v1` |
| 模型名 | 服务商文档中的模型标识 | `your-model-name` |
| API Key | 服务商控制台申请，仅保存在服务端 | `sk-your-api-key` |

> 请使用你自己的服务商账号与 Key，不要在仓库或代码中硬编码真实密钥。

## 使用流程

1. 注册或登录，在「模型配置」中填写接口并测试连通性。
2. 在「角色」页确认或调整角色及其执行顺序。
3. 在工作台新建会话并输入需求，观察进度条和消息池中的协作过程，必要时中断。
4. 在产物面板预览网页、切换版本、下载文件或 ZIP。
5. 继续发消息迭代，或在左侧会话栏回到任意历史会话。

## 环境变量

如需本地配置，请自行创建 `.env`（已被 `.gitignore` 排除）。仓库中不包含任何真实密钥。

## 常见问题

**Q：连通性测试失败怎么办？**
确认 Base URL 以 `/v1` 结尾、模型名正确、Key 有效且有额度，并确认后端所在机器能访问该地址。

**Q：生成的页面用了 localStorage，预览会报错吗？**
不会。预览沙箱出于安全考虑不开启 `allow-same-origin`，站点会在预览中注入内存存储垫片，数据在刷新预览后清空；下载的文件保持原样。

**Q：输出被截断？**
单步输出有长度上限，可把需求拆成多轮对话逐步补齐。

**Q：任务能中途停止吗？**
可以，已生成的消息与产物会保留，之后可继续迭代。

## 安全说明

- API Key 只保存在服务端，接口返回脱敏，不写入日志。
- `.env`、`node_modules`、`dist` 均被 `.gitignore` 排除。
- 预览使用沙箱 iframe（不含 `allow-same-origin`），无法访问站点登录态。
