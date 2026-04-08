<p align="center">
  <strong>claude-code-mini</strong>
</p>

<p align="center">
  <a href="./README_EN.md">English</a> | 中文
</p>

<p align="center">
  一个受 Claude Code 启发的轻量级终端 AI 编码助手，使用 TypeScript 构建。
</p>

> 本项目 Fork 自 [claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)，在此基础上进行了大量重构和功能扩展。

---

## 特性

- **双后端支持** — 兼容 Anthropic (Claude) 和 OpenAI 协议的 API，一行命令切换
- **三级模型分层** — pro（主对话）/ lite（子代理）/ mini（摘要），按任务复杂度自动路由，优化成本
- **21 个内置工具** — 文件读写、代码搜索、Shell 执行、Git 操作、Web 搜索、任务管理等
- **MCP 协议支持** — 通过 Model Context Protocol 连接外部工具服务器，支持 stdio 和 HTTP 传输，工具自动发现与命名空间隔离
- **子代理系统** — 内置 explore / plan / general 三种类型，支持自定义代理，隔离执行
- **技能扩展** — 通过 `.ccmini/skills/` 目录定义可复用的技能，支持 inline 和 fork 两种模式
- **上下文压缩** — 4 级压缩流水线（budget → snip → microcompact → auto-compact），前 3 级零 API 成本
- **权限管理** — 5 种权限模式，危险命令自动检测，支持按规则持久化
- **流式输出** — 实时流式文本 + 并行安全工具自动并行执行
- **StarDust 终端主题** — 精美的终端视觉样式，内置轻量级语法高亮（TS/JS、Python、JSON、Shell、Go、Rust 等）
- **会话持久化** — 自动保存/恢复会话，支持 `--resume` 续接
- **文件变更追踪** — 按轮次记录文件变更，支持 `/revert` 一键撤销
- **记忆系统** — 4 种类型的持久化文件记忆（user / feedback / project / reference）
- **API 重试** — 指数退避自动重试（429 / 503 / 529 / 超时）
- **Tab 补全** — REPL 模式下按 Tab 自动补全命令和技能

## 快速开始

### 安装

```bash
git clone https://github.com/your-repo/claude-code-mini.git
cd claude-code-mini
npm install
npm run build
```

### 配置 API

交互式配置：

```bash
claude-code-mini --connect
```

或手动编辑 `~/.ccmini/settings.json`：

```json
{
  "api": {
    "provider": "openai",
    "baseUrl": "https://your-api-endpoint.com/v1",
    "apiKey": "sk-xxx"
  },
  "models": {
    "pro": "your-main-model",
    "lite": "your-lite-model",
    "mini": "your-mini-model"
  }
}
```

### 使用

**交互式 REPL：**

```bash
claude-code-mini
```

**一次性命令：**

```bash
claude-code-mini "修复 src/app.ts 中的 bug"
claude-code-mini --yolo "运行所有测试并修复失败"
claude-code-mini --plan "你会如何重构这个项目？"
claude-code-mini --model gpt-4o "hello"
claude-code-mini --resume  # 恢复上次会话
```

## CLI 选项

| 选项 | 缩写 | 说明 |
|------|------|------|
| `--yolo` | `-y` | 跳过所有确认（bypassPermissions 模式） |
| `--plan` | | 计划模式：只读，描述变更但不执行 |
| `--accept-edits` | | 自动批准文件编辑，危险 Shell 命令仍需确认 |
| `--dont-ask` | | 自动拒绝需确认的操作（适合 CI） |
| `--thinking` | | 启用扩展思考（仅 Anthropic） |
| `--model` | `-m` | 指定模型（默认从配置读取或 `glm-5`） |
| `--resume` | | 恢复上次会话 |
| `--max-turns N` | | 限制代理循环最大轮次 |
| `--connect` | | 交互式配置 API 提供商 |
| `--help` | `-h` | 显示帮助 |

## REPL 斜杠命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有可用命令 |
| `/clear` | 清除对话历史 |
| `/compact` | 手动压缩对话 |
| `/model [tier] [name]` | 查看/切换模型或层级（pro/lite/mini） |
| `/memory` | 列出已保存的记忆 |
| `/connect` | 交互式连接 API 提供商 |
| `/trace` | 按轮次显示所有文件变更 |
| `/revert` | 撤销上一轮的文件变更 |
| `/skills` | 列出可用技能 |
| `/mcp [reload [name]]` | 查看 MCP 服务器状态 / 重连指定或全部服务器 |
| `/<skill-name>` | 调用用户定义的技能 |

提示：输入 `/` 后按 **Tab** 键可查看所有可用命令和技能。

## 内置工具

### 文件操作

| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容，支持分页 |
| `write_file` | 写入/创建文件 |
| `edit_file` | 精确字符串匹配替换编辑 |

### 搜索

| 工具 | 说明 |
|------|------|
| `list_files` | Glob 模式文件搜索 |
| `grep_search` | 正则表达式代码搜索 |
| `web_search` | DuckDuckGo 网络搜索 |

### Git

| 工具 | 说明 |
|------|------|
| `git_status` | 仓库状态 |
| `git_diff` / `git_diff_staged` | 查看变更 |
| `git_log` / `git_show` / `git_blame` | 提交历史 |
| `git_branch` / `git_remote` | 分支和远程 |

### 执行

| 工具 | 说明 |
|------|------|
| `run_shell` | 执行 Shell 命令（支持超时） |

### 代理

| 工具 | 说明 |
|------|------|
| `agent` | 启动子代理处理独立任务 |
| `skill` | 调用已注册的技能 |
| `ask_user` | 向用户提问并等待回复 |

### 任务管理

| 工具 | 说明 |
|------|------|
| `task_create` / `task_update` / `task_list` | 创建、更新、列出任务 |

## 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 读取类自动允许，写入类需确认，危险命令需确认 |
| `plan` | 只读模式，拒绝所有写入操作 |
| `acceptEdits` | 自动批准文件编辑，危险 Shell 仍需确认 |
| `bypassPermissions` | 跳过所有权限检查（`--yolo`） |
| `dontAsk` | 自动拒绝需确认的操作（适合 CI） |

权限规则可持久化到 `.ccmini/settings.json`，支持 allow/deny 列表和通配符匹配。

## 三级模型系统

| 层级 | 用途 | 默认模型 |
|------|------|---------|
| **pro** | 主对话、复杂推理 | `glm-5` |
| **lite** | 子代理、探索、规划 | `minimax-m2.5` |
| **mini** | 摘要、快速查询 | `kimi-k2.5` |

配置优先级（高 → 低）：
1. 运行时：`/model pro <name>` 命令
2. 配置文件：`.ccmini/settings.json` → `{ "models": { "pro": "..." } }`
3. 内置默认值

子代理自动路由：explore → lite，plan → lite，general → pro，compact → mini。

## MCP 协议支持

claude-code-mini 支持通过 [Model Context Protocol](https://modelcontextprotocol.io/) 连接外部工具服务器，自动发现并注册工具。

### 配置

在 `~/.ccmini/settings.json` 或项目级 `.ccmini/settings.json` 中添加 `mcpServers`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    },
    "remote-api": {
      "url": "https://mcp-server.example.com/sse",
      "headers": { "Authorization": "Bearer xxx" }
    }
  }
}
```

- **stdio 传输**：通过 `command` + `args` 启动本地进程
- **HTTP 传输**：通过 `url` 连接远程 SSE 端点
- **禁用服务器**：添加 `"disabled": true` 跳过连接
- **命名空间**：MCP 工具自动命名为 `mcp__{serverName}__{toolName}`，避免冲突
- **权限**：MCP 工具遵循与内置工具相同的权限系统，可在 `permissions.allow` 中配置

### REPL 命令

- `/mcp` — 查看所有 MCP 服务器状态
- `/mcp reload [name]` — 重连指定服务器（省略 name 则重连全部）

## 扩展

### 自定义技能

在 `.ccmini/skills/<name>/SKILL.md` 创建技能文件：

```markdown
---
name: commit
description: Generate a git commit message
user-invocable: true
context: inline
---

分析当前 git diff，生成规范的 commit message。
```

### 自定义代理

在 `.ccmini/agents/<name>.md` 创建代理配置：

```markdown
---
name: reviewer
description: Code review agent
allowed-tools: read_file, grep_search, list_files
model: lite
---

你是一个代码审查专家。审查代码中的 bug、安全漏洞和性能问题。
```

## 项目结构

```
src/
├── cli.ts                # 入口
├── cli/                  # CLI（参数解析、REPL、命令）
├── core/                 # 核心（Agent、压缩、模型分层、提示词）
├── backend/              # API 后端（Anthropic / OpenAI）
├── mcp/                  # MCP 协议（客户端、管理器、传输、配置）
├── tools/                # 工具系统（定义、执行、权限）
├── ui/                   # 终端 UI（StarDust 主题、语法高亮）
├── storage/              # 持久化（会话、记忆、文件追踪）
└── extensions/           # 扩展（技能、子代理）
```

## 开发

```bash
npm run build          # 编译 TypeScript
npm run dev            # 编译并启动 REPL
npx tsc --noEmit       # 类型检查
npm test               # 运行测试
```

## License

MIT
