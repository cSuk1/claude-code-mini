# Claude Code Mini

[English](README_EN.md) | 简体中文

一个从零实现的极简 AI 编程代理，灵感来自 [Claude Code](https://claude.ai/code)。

> Forked from [Windy3f3f3f3f/claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch)，在原项目基础上进行了大量改进。

## 特性

- **双后端支持**：Anthropic Claude（原生）+ 任意 OpenAI 兼容 API
- **三层模型架构**：pro / lite / mini 三级模型，自动路由 sub-agent 到低成本模型
- **7 个内置工具**：read_file、write_file、edit_file、list_files、grep_search、run_shell、skill
- **4 种内置代理**：explore（只读探索）、plan（规划）、general（全功能）、compact（压缩）
- **自定义扩展**：通过 `.ccmini/agents/` 和 `.ccmini/skills/` 定义专属代理和技能
- **4 层上下文压缩**：budget → snip → microcompact → auto-compact
- **5 种权限模式**：default / plan / acceptEdits / bypassPermissions / dontAsk
- **会话持久化**：自动保存对话，`--resume` 恢复上次会话
- **记忆系统**：按项目存储 user / feedback / project / reference 四类记忆
- **Tab 补全**：REPL 中支持命令和技能的 Tab 补全
- **扩展思考**：支持 Claude 4.6 的 adaptive thinking

## 快速开始

```bash
# 安装依赖
npm install

# 构建
npm run build

# 设置 API Key（二选一）
export ANTHROPIC_API_KEY=sk-ant-...
# 或使用 OpenAI 兼容接口
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-api.com/v1

# 交互模式
npm start

# 单次执行
node dist/cli.js "修复 src/app.ts 中的 bug"

# 开发模式（构建 + 立即运行）
npm run dev
```

## CLI 参数

```
用法: claude-code-mini [选项] [提示词]

选项:
  --yolo, -y          跳过所有确认提示
  --plan              只读模式，只分析不执行
  --accept-edits      自动批准文件编辑，危险命令仍需确认
  --dont-ask          自动拒绝所有需要确认的操作（适用于 CI）
  --thinking          启用扩展思考（仅 Anthropic）
  --model, -m MODEL   指定模型
  --api-base URL      使用 OpenAI 兼容端点
  --resume            恢复上次会话
  --max-cost USD      费用上限（美元）
  --max-turns N       最大轮次限制
  --help, -h          显示帮助
```

## REPL 命令

交互模式下可用：

| 命令 | 说明 |
|------|------|
| `/help` | 显示所有可用命令 |
| `/model [tier] [name]` | 显示/切换模型或层级 |
| `/clear` | 清空对话历史 |
| `/cost` | 显示 token 用量和费用 |
| `/compact` | 手动压缩对话 |
| `/memory` | 列出已保存的记忆 |
| `/skills` | 列出可用技能 |
| `/<技能名> [参数]` | 调用技能 |

支持 Tab 补全命令和技能名称。

## 三层模型系统

| 层级 | 用途 | 默认模型 |
|------|------|----------|
| **pro** | 主对话、复杂推理、general agent | `glm-5` |
| **lite** | sub-agent、explore、plan | `minimax-m2.5` |
| **mini** | compact 压缩、简单查询 | `kimi-k2.5` |

配置优先级（高 → 低）：
1. Runtime: `/model pro <模型名>`
2. 环境变量: `MINI_CLAUDE_MODEL_PRO` / `_LITE` / `_MINI`
3. 配置文件: `.ccmini/settings.json`
4. 内置默认值

## 项目结构

```
src/
├── cli.ts                    # 主入口
├── cli/
│   ├── args.ts               # 参数解析
│   ├── commands.ts           # Slash 命令注册
│   ├── config.ts             # API 配置解析
│   └── repl.ts               # REPL 交互循环
├── core/
│   ├── agent.ts              # Agent 核心类（~1050 行）
│   ├── agent-compression.ts  # 上下文压缩管线
│   ├── agent-model.ts        # 模型切换逻辑
│   ├── agent-retry.ts        # API 重试逻辑
│   ├── model-tiers.ts        # 三层模型系统
│   └── prompt.ts             # 系统提示词构建
├── tools/
│   ├── definitions.ts        # 工具定义（Anthropic 格式）
│   ├── dispatcher.ts         # 工具调度
│   ├── executors.ts          # 工具实现
│   ├── permissions.ts        # 权限检查
│   └── tools.ts              # 模块导出
├── ui/
│   └── ui.ts                 # 终端 UI
├── storage/
│   ├── session.ts            # 会话持久化
│   └── memory.ts             # 记忆系统
├── extensions/
│   ├── skills.ts             # 技能发现与执行
│   └── subagent.ts           # 子代理系统
├── utils/
│   └── frontmatter.ts        # YAML frontmatter 解析
└── templates/
    ├── system-prompt.md      # 系统提示词模板
    └── plan-mode-prompt.md   # Plan 模式模板

.ccmini/
├── settings.json             # 项目配置
├── agents/                   # 自定义代理
│   └── *.md
└── skills/                   # 自定义技能
    └── */SKILL.md
```

## 架构概览

### 执行流程

```
cli.ts → parseArgs() → resolveApiConfig() → new Agent() → chat() 或 runRepl()
```

### Agent 核心循环

```
用户输入 → 压缩管线 → API 调用 → 解析响应
                              ├── 文本 → 输出到终端
                              └── 工具调用 → 权限检查 → 执行 → 结果入历史 → 继续循环
```

### 上下文压缩管线

每次 API 调用前执行 4 层渐进式压缩（前 3 层零 API 消耗）：

| 层级 | 名称 | 触发条件 | 策略 |
|------|------|----------|------|
| 1 | Budget | 上下文利用率 > 50% | 截断大的工具结果，保留头尾 |
| 2 | Snip | 利用率超过阈值 | 用占位符替换旧的/重复的工具结果 |
| 3 | Microcompact | 空闲超过 5 分钟 | 激进清除旧结果（prompt cache 已冷） |
| 4 | Auto-compact | 利用率 > 85% | 调用 API 对整段对话进行摘要压缩 |

## 扩展系统

### 自定义代理

在 `.ccmini/agents/<名称>.md` 中定义：

```yaml
---
name: test-writer
description: 编写单元测试的代理
allowed-tools: read_file, write_file, grep_search
model: lite
---

你是一个专门的测试编写代理。为源代码编写单元测试。
```

### 自定义技能

在 `.ccmini/skills/<名称>/SKILL.md` 中定义：

```yaml
---
name: commit
description: 生成 Git commit 消息
user-invocable: true
mode: inline
---

根据 git diff 生成 commit 消息。格式：
- 第一行：简短摘要
- 空行
- 详细描述
```

在 REPL 中通过 `/commit` 调用。

### 权限配置

在 `.ccmini/settings.json` 中配置：

```json
{
  "permissionMode": "default",
  "models": {
    "pro": "claude-sonnet-4-20250514",
    "lite": "claude-3-5-haiku-20241022",
    "mini": "claude-3-5-haiku-20241022"
  },
  "tools": {
    "read_file": "allow",
    "write_file": "ask",
    "run_shell": "ask"
  }
}
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `ANTHROPIC_BASE_URL` | Anthropic 自定义端点（可选） |
| `OPENAI_API_KEY` | OpenAI 兼容 API 密钥 |
| `OPENAI_BASE_URL` | OpenAI 兼容端点 |
| `MINI_CLAUDE_MODEL` | 覆盖 pro 层级模型 |
| `MINI_CLAUDE_MODEL_PRO` | 覆盖 pro 层级模型 |
| `MINI_CLAUDE_MODEL_LITE` | 覆盖 lite 层级模型 |
| `MINI_CLAUDE_MODEL_MINI` | 覆盖 mini 层级模型 |

## 使用示例

```bash
# 基本使用
claude-code-mini "解释这个项目的架构"

# 跳过确认，全自动执行
claude-code-mini --yolo "运行所有测试并修复失败的用例"

# 只读分析模式
claude-code-mini --plan "如何重构这个模块？"

# 自动批准编辑
claude-code-mini --accept-edits "给 api.ts 添加错误处理"

# 设置费用和轮次上限
claude-code-mini --max-cost 0.50 --max-turns 20 "实现功能 X"

# 使用 OpenAI 兼容接口
OPENAI_API_KEY=sk-xxx claude-code-mini --api-base https://api.example.com/v1 --model gpt-4o "你好"

# 恢复上次对话
claude-code-mini --resume
```

## 依赖

- `@anthropic-ai/sdk` — Anthropic API 客户端
- `openai` — OpenAI API 客户端
- `chalk` — 终端颜色
- `glob` — 文件模式匹配

## 许可证

MIT
