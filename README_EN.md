<p align="center">
  <strong>claude-code-mini</strong>
</p>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

<p align="center">
  A lightweight terminal AI coding assistant inspired by Claude Code, built with TypeScript.
</p>

> Forked from [claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch) with extensive refactoring and feature additions.

---

## Features

- **Dual Backend Support** — Compatible with both Anthropic (Claude) and OpenAI protocol APIs, switch with a single flag
- **Three-Tier Model System** — pro (main chat) / lite (sub-agents) / mini (summarization), auto-routed by task complexity for cost optimization
- **21 Built-in Tools** — File I/O, code search, shell execution, Git operations, web search, task management, and more
- **Sub-Agent System** — Built-in explore / plan / general agent types, plus custom agent support with isolated execution
- **Skill Extensions** — Define reusable skills via `.ccmini/skills/` directory with inline and fork execution modes
- **Context Compression** — 4-tier pipeline (budget → snip → microcompact → auto-compact), first 3 tiers at zero API cost
- **Permission Management** — 5 permission modes with dangerous command detection and persistent rule-based policies
- **Streaming Output** — Real-time streaming text with automatic parallel execution for parallel-safe tools
- **Session Persistence** — Auto-save/restore sessions with `--resume` support
- **File Change Tracking** — Per-turn change recording with `/revert` for one-click undo
- **Memory System** — 4-type persistent file-based memory (user / feedback / project / reference)
- **API Retry** — Exponential backoff auto-retry for 429 / 503 / 529 / timeouts
- **Tab Completion** — Tab auto-completion for commands and skills in REPL mode

## Quick Start

### Install

```bash
git clone https://github.com/your-repo/claude-code-mini.git
cd claude-code-mini
npm install
npm run build
```

### Configure API

Interactive setup:

```bash
claude-code-mini --connect
```

Or manually edit `~/.ccmini/settings.json`:

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

### Usage

**Interactive REPL:**

```bash
claude-code-mini
```

**One-shot mode:**

```bash
claude-code-mini "fix the bug in src/app.ts"
claude-code-mini --yolo "run all tests and fix failures"
claude-code-mini --plan "how would you refactor this?"
claude-code-mini --model gpt-4o "hello"
claude-code-mini --resume  # Resume last session
```

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--yolo` | `-y` | Skip all confirmations (bypassPermissions mode) |
| `--plan` | | Plan mode: read-only, describe changes without executing |
| `--accept-edits` | | Auto-approve file edits, still confirm dangerous shell commands |
| `--dont-ask` | | Auto-deny anything needing confirmation (for CI) |
| `--thinking` | | Enable extended thinking (Anthropic only) |
| `--model` | `-m` | Model to use (default from config or `glm-5`) |
| `--resume` | | Resume the last session |
| `--max-turns N` | | Stop after N agentic turns |
| `--connect` | | Interactively connect to an API provider |
| `--help` | `-h` | Show help |

## REPL Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation history |
| `/compact` | Manually compact conversation |
| `/model [tier] [name]` | Show/switch model or tier (pro/lite/mini) |
| `/memory` | List saved memories |
| `/connect` | Interactively connect to an API provider |
| `/trace` | Show all file changes by turn |
| `/revert` | Revert the last turn's file changes |
| `/skills` | List available skills |
| `/<skill-name>` | Invoke a user-defined skill |

Tip: Press **Tab** after typing `/` to see all available commands and skills.

## Built-in Tools

### File Operations

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with pagination |
| `write_file` | Write/create files |
| `edit_file` | Edit files via exact string match replacement |

### Search

| Tool | Description |
|------|-------------|
| `list_files` | Glob pattern file search |
| `grep_search` | Regex code search |
| `web_search` | DuckDuckGo web search |

### Git

| Tool | Description |
|------|-------------|
| `git_status` | Repository status |
| `git_diff` / `git_diff_staged` | View changes |
| `git_log` / `git_show` / `git_blame` | Commit history |
| `git_branch` / `git_remote` | Branches and remotes |

### Execution

| Tool | Description |
|------|-------------|
| `run_shell` | Execute shell commands (with timeout) |

### Agent

| Tool | Description |
|------|-------------|
| `agent` | Launch sub-agents for independent tasks |
| `skill` | Invoke registered skills |
| `ask_user` | Ask the user a question and wait for response |

### Task Management

| Tool | Description |
|------|-------------|
| `task_create` / `task_update` / `task_list` | Create, update, and list tasks |

## Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Read ops auto-allowed, write ops need confirmation, dangerous commands need confirmation |
| `plan` | Read-only mode, all write operations denied |
| `acceptEdits` | Auto-approve file edits, dangerous shell commands still need confirmation |
| `bypassPermissions` | Skip all permission checks (`--yolo`) |
| `dontAsk` | Auto-deny anything needing confirmation (for CI) |

Permission rules can be persisted to `.ccmini/settings.json` with allow/deny lists and wildcard matching.

## Three-Tier Model System

| Tier | Usage | Default Model |
|------|-------|---------------|
| **pro** | Main conversation, complex reasoning | `glm-5` |
| **lite** | Sub-agents, exploration, planning | `minimax-m2.5` |
| **mini** | Summarization, quick queries | `kimi-k2.5` |

Configuration priority (high → low):
1. Runtime: `/model pro <name>` command
2. Config file: `.ccmini/settings.json` → `{ "models": { "pro": "..." } }`
3. Built-in defaults

Sub-agent auto-routing: explore → lite, plan → lite, general → pro, compact → mini.

## Extensions

### Custom Skills

Create a skill file at `.ccmini/skills/<name>/SKILL.md`:

```markdown
---
name: commit
description: Generate a git commit message
user-invocable: true
context: inline
---

Analyze the current git diff and generate a conventional commit message.
```

### Custom Agents

Create an agent config at `.ccmini/agents/<name>.md`:

```markdown
---
name: reviewer
description: Code review agent
allowed-tools: read_file, grep_search, list_files
model: lite
---

You are a code review expert. Review code for bugs, security vulnerabilities, and performance issues.
```

## Project Structure

```
src/
├── cli.ts                # Entry point
├── cli/                  # CLI (args, REPL, commands)
├── core/                 # Core (Agent, compression, model tiers, prompts)
├── backend/              # API backends (Anthropic / OpenAI)
├── tools/                # Tool system (definitions, executors, permissions)
├── ui/                   # Terminal UI
├── storage/              # Persistence (sessions, memory, file tracker)
└── extensions/           # Extensions (skills, sub-agents)
```

## Development

```bash
npm run build          # Compile TypeScript
npm run dev            # Build and start REPL
npx tsc --noEmit       # Type check
npm test               # Run tests
```

## License

MIT
