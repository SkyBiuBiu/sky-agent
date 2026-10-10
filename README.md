<div align="center">

# Sky Agent

**一句需求，交给一支虚拟软件团队：产品经理 → 架构师 → 工程师 → QA工程师 协作产出可运行网页**

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)
![OpenAI Compatible](https://img.shields.io/badge/模型-OpenAI%20兼容接口-412991)

<img src="docs/images/workbench.jpg" width="900" alt="工作台全貌：左侧会话栏、顶部执行进度条、右侧对话与产物" />

</div>

> **演示账号**：`demo` / `demo123`，登录页可一键登录（只读，无法执行写操作）。

## 目录

- [功能亮点](#功能亮点)
- [界面预览](#界面预览)
- [快速开始](#快速开始)
- [模型配置](#模型配置)
- [目录结构](#目录结构)
- [常见问题](#常见问题)

## 功能亮点

| 模块 | 说明 |
| --- | --- |
| 账号 | 邮箱注册、登录、修改密码；提供只读演示账号 |
| 工作台 | 左侧会话栏 + 右侧工作区，会话支持搜索、分组、删除 |
| 执行进度 | 只读进度条，执行顺序以「我的角色」为准 |
| 我的角色 | 默认 4 个角色；左右分栏，拖拽排序，新建为空白表单 |
| 对话式迭代 | 持续追加需求生成新版本，运行中可随时中断 |
| 共享消息池 | 各角色产出按时间线发布，过程可追溯 |
| 产物预览 | 沙箱预览，兼容 localStorage；支持版本切换、单文件或 ZIP 下载 |
| 模型配置 | 使用自己的 OpenAI 兼容接口，支持连通性测试 |

## 界面预览

### 工作台

会话栏、执行进度条与对话流集中在一屏（见页首大图）。

<table>
  <tr>
    <td width="50%" valign="top">
      <b>共享消息池</b><br/>
      <sub>需求 → PRD → 系统设计 → 代码 → 测试报告，按时间线展示</sub><br/><br/>
      <img src="docs/images/message-pool.jpg" width="100%" alt="共享消息池" />
    </td>
    <td width="50%" valign="top">
      <b>产物预览</b><br/>
      <sub>「待办清单 Demo」在沙箱中可直接添加、勾选、删除</sub><br/><br/>
      <img src="docs/images/artifact-preview.jpg" width="100%" alt="产物预览" />
    </td>
  </tr>
</table>

### 我的角色

左侧角色列表可拖拽排序，右侧编辑角色详情。

<img src="docs/images/roles.jpg" width="900" alt="我的角色：左右分栏" />

<table>
  <tr>
    <td width="50%" valign="top">
      <b>模型配置</b><br/>
      <sub>填写 Base URL、模型名、API Key（脱敏显示）</sub><br/><br/>
      <img src="docs/images/model-config.jpg" width="100%" alt="模型配置" />
    </td>
    <td width="50%" valign="top">
      <b>登录 / 注册</b><br/>
      <sub>支持演示账号一键登录</sub><br/><br/>
      <img src="docs/images/login.jpg" width="100%" alt="登录页" />
    </td>
  </tr>
</table>

## 快速开始

**方式一：一键启动（推荐）**

```bash
cd app
bash start_app_v2.sh
```

**方式二：分别启动前后端**

```bash
# 后端
cd app/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端（另开一个终端）
cd app/frontend
pnpm install
pnpm run dev
```

**构建校验**

```bash
cd app/frontend
pnpm run lint && pnpm run build
```

> 数据库、登录、对象存储由 Atoms Cloud 平台注入，本地运行需要平台提供的后端环境变量。

## 模型配置

登录后进入「模型配置」，填写以下三项并点击「连通性测试」：

| 配置项 | 说明 | 示例（占位符） |
| --- | --- | --- |
| Base URL | OpenAI 兼容接口地址，通常以 `/v1` 结尾 | `https://api.example.com/v1` |
| 模型名 | 服务商文档中的模型标识 | `your-model-name` |
| API Key | 仅保存在服务端，展示时脱敏 | `sk-your-api-key` |

> **注意**：请使用自己的 Key，不要把真实密钥写进仓库或代码；`.env` 已被 `.gitignore` 排除。

**使用流程**

1. 注册或登录，完成模型配置。
2. 在「角色」页确认角色及执行顺序。
3. 在工作台新建会话并输入需求，观察进度条与消息池，必要时中断。
4. 预览产物、切换版本、下载文件或 ZIP；继续发消息迭代。

## 目录结构

```text
.
├── README.md
├── docs/images/                  # README 界面截图
└── app/
    ├── start_app_v2.sh           # 本地启动脚本
    ├── backend/                  # FastAPI + Atoms Cloud
    │   ├── routers/sky.py        # 核心接口
    │   ├── services/sky.py       # 角色编排、模型调用、产物解析
    │   └── services/accounts.py  # 账号与演示数据
    └── frontend/                 # Vite + React + TypeScript + shadcn/ui
        └── src/
            ├── components/sky/   # 工作台、消息池、产物、角色、配置
            ├── lib/sky.ts        # 数据访问、预览组装（含存储垫片）、下载
            └── pages/Index.tsx   # 主页面
```

## 常见问题

<details>
<summary><b>连通性测试失败怎么办？</b></summary>

确认 Base URL 以 `/v1` 结尾、模型名正确、Key 有效且有额度，并确认后端所在机器能访问该地址。
</details>

<details>
<summary><b>生成的页面用了 localStorage，预览会报错吗？</b></summary>

不会。预览沙箱不开启 `allow-same-origin`，站点会在预览中注入内存存储垫片，刷新预览后数据清空；下载的文件保持原样。
</details>

<details>
<summary><b>输出被截断？</b></summary>

单步输出有长度上限，可把需求拆成多轮对话逐步补齐。
</details>

<details>
<summary><b>任务能中途停止吗？API Key 安全吗？</b></summary>

可以随时中断，已生成的消息与产物会保留。API Key 只保存在服务端，接口返回脱敏，不写入日志；预览 iframe 无法访问站点登录态。
</details>
