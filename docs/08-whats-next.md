# 8. 架构对比与下一步

## 本章目标

全面对比 mini-claude 与 Claude Code 的架构差异，列出未实现的功能，并给出扩展方向。

## 完整架构对比

| 组件 | Claude Code | mini-claude | 差异 |
|------|------------|-------------|------|
| **Agent Loop** | async generator + 7 种 continue reason | while(true) + tool_use 检查 | 简化循环控制 |
| **工具数量** | 66+ 工具 | 6 个核心工具 | 去掉特化工具 |
| **工具架构** | 抽象类 + 注册表 + 并发执行 | 数组 + switch + 串行 | 去掉抽象层 |
| **API 后端** | Anthropic only | Anthropic + OpenAI 兼容 | 多了 OpenAI |
| **流式输出** | SSE → React/Ink | SDK stream / 手动累积 | 直接输出 |
| **System Prompt** | 代码常量 + 缓存优化 | Markdown 模板 | 去掉缓存 |
| **权限系统** | 5 层 + AST 分析 + 52KB | 正则 + 确认 + 白名单 | 大幅简化 |
| **上下文管理** | 4 级压缩流水线 | 截断 + 摘要替换 | 单级压缩 |
| **UI 框架** | React/Ink TUI | chalk + console | 去掉 React |
| **参数解析** | commander.js | 手写循环 | 零依赖 |
| **会话管理** | JSONL + 复杂索引 | JSON 文件 | 简化格式 |
| **总代码量** | ~50 万行 | ~1300 行 | 99.7% 减少 |

## 文件映射表

mini-claude 每个文件在 Claude Code 中的对应位置：

| mini-claude | Claude Code 源码 | 说明 |
|------------|-------------------|------|
| `src/agent.ts` | `src/query.ts` + `src/QueryEngine.ts` | Agent 循环 + 会话管理 |
| `src/tools.ts` | `src/Tool.ts` + `src/tools/` (66 个目录) | 工具定义与执行 |
| `src/prompt.ts` | `src/constants/prompts.ts` + `src/utils/claudemd.ts` | Prompt 构造 |
| `src/cli.ts` | `src/entrypoints/cli.tsx` + `src/commands/` | 入口与命令 |
| `src/ui.ts` | `src/components/` (React/Ink 组件) | UI 渲染 |
| `src/session.ts` | `src/utils/sessionStorage.ts` + `src/history.ts` | 会话持久化 |
| `src/system-prompt.md` | `src/constants/prompts.ts` (内联字符串) | Prompt 模板 |

## 我们没实现的

以下是 Claude Code 有但我们刻意省略的功能：

### Sub-agents（子代理）
Claude Code 可以启动子 agent 并行处理子任务。实现在 `src/tools/AgentTool/`。

### MCP（Model Context Protocol）
标准化的外部工具协议，允许接入数据库、API 等。Claude Code 通过 MCP 客户端动态加载工具。

### LSP 集成
与 IDE 的 Language Server Protocol 集成，提供代码补全、诊断等信息给 agent。

### Notebook 支持
Jupyter Notebook 的读写和编辑工具 (`NotebookEditTool`)。

### OAuth / 身份认证
Web 端的 OAuth 流程，支持在云端运行。

### Vim Mode
终端内的 Vim 键绑定支持。

### 多文件并发编辑
`StreamingToolExecutor` 让多个文件操作并发执行。

### 持久化权限
`.claude/settings.json` 中的持久化权限配置。

### Prompt Caching
Anthropic API 的 prompt caching，复用 static prompt 部分。

### Memory 系统
自动/手动保存的记忆系统，跨会话保持偏好。

## 读者可以扩展的方向

### 1. 添加 Sub-agent

最有价值的扩展。核心思路：把 `Agent` 类实例化为子 agent，作为一个工具暴露给主 agent：

```typescript
// 伪代码
{
  name: "sub_agent",
  description: "Launch a sub-agent for complex, independent tasks",
  input_schema: {
    properties: {
      task: { type: "string", description: "The task for the sub-agent" }
    }
  }
}

async function executeSubAgent(task: string): Promise<string> {
  const subAgent = new Agent({ model: this.model });
  // 限制工具集、限制 token 预算
  const result = await subAgent.chat(task);
  return result;
}
```

参考 Claude Code 的 `src/tools/AgentTool/AgentTool.ts`。

### 2. 添加 MCP 工具支持

MCP 是一个标准协议，可以动态加载外部工具：

```typescript
// 伪代码
import { MCPClient } from "@anthropic-ai/mcp";

const client = new MCPClient("npx @modelcontextprotocol/server-filesystem /tmp");
const mcpTools = await client.listTools();
// 将 MCP 工具转为 toolDefinitions 格式并合并
toolDefinitions.push(...mcpTools.map(convertToToolDef));
```

### 3. 用 Ink 替换 chalk 做 TUI

Ink 是 React 的终端渲染器，可以实现更丰富的 UI：

```bash
npm install ink ink-spinner ink-text-input react
```

用 React 组件替换 `ui.ts` 中的函数，获得 spinner、进度条、分栏布局等能力。

### 4. 添加持久化权限

在 `~/.mini-claude/permissions.json` 中保存用户的权限决策：

```json
{
  "allowed_commands": ["npm test", "npm run build"],
  "allowed_paths": ["/home/user/project/**"],
  "denied_patterns": ["rm -rf /"]
}
```

### 5. 添加更多工具

一些有用的工具想法：

- **web_search** — 搜索引擎 API，让 agent 能查文档
- **image_read** — 传给多模态模型分析截图
- **diff_view** — 显示 git diff，方便代码审查
- **test_runner** — 专用的测试运行工具，带智能输出解析

## 交叉引用

想深入了解 Claude Code 各模块的设计原理？参考兄弟项目的详细文档：

| 主题 | 本教程 | how-claude-code-works |
|------|--------|----------------------|
| Agent 循环 | [Ch1: Agent Loop](docs/01-agent-loop.md) | [系统主循环](https://windy3f3f3f3f.github.io/how-claude-code-works/#/docs/02-agent-loop) |
| 工具系统 | [Ch2: 工具系统](docs/02-tools.md) | [工具系统](https://windy3f3f3f3f.github.io/how-claude-code-works/#/docs/04-tool-system) |
| 上下文管理 | [Ch6: 上下文管理](docs/06-context.md) | [上下文工程](https://windy3f3f3f3f.github.io/how-claude-code-works/#/docs/03-context-engineering) |
| 权限安全 | [Ch5: 权限与安全](docs/05-safety.md) | [权限与安全](https://windy3f3f3f3f.github.io/how-claude-code-works/#/docs/06-permission-security) |
| 代码编辑 | [Ch2: edit_file](docs/02-tools.md) | [代码编辑策略](https://windy3f3f3f3f.github.io/how-claude-code-works/#/docs/05-code-editing-strategy) |

---

## 结语

1300 行代码，6 个文件，覆盖了一个 coding agent 的所有核心组件：

- **Agent Loop** — while 循环 + tool_use 检查
- **工具系统** — 6 个核心工具 + switch 分发
- **System Prompt** — Markdown 模板 + 环境注入
- **流式输出** — 双后端支持
- **权限安全** — 正则检测 + 确认 + 白名单
- **上下文管理** — 截断 + 自动摘要压缩
- **CLI / 会话** — REPL + JSON 持久化

Claude Code 的 50 万行代码中，有大量是在处理边缘情况、支持多种运行环境、提供企业级可靠性。但核心 agent 能力——理解用户意图 → 调用工具操作代码 → 迭代直到完成——就是这 1300 行的事。

现在你有了一个可以工作的 coding agent，也理解了它背后每一行代码的设计意图。去扩展它吧。
