# Claude Code Mini

English | [简体中文](README.md)

A minimal AI coding agent built from scratch in TypeScript, inspired by [Claude Code](https://claude.ai/code).

> Forked from [Windy3f3f3f3f/claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch), heavily modified with many improvements.

## Features

- **Dual backend support**: Anthropic Claude (native) + any OpenAI-compatible API
- **Three-tier model system**: pro / lite / mini levels with automatic sub-agent routing to cost-effective models
- **7 built-in tools**: read_file, write_file, edit_file, list_files, grep_search, run_shell, skill
- **4 built-in agents**: explore (read-only), plan (analysis), general (full tools), compact (summarization)
- **Custom extensions**: Define agents and skills via `.ccmini/agents/` and `.ccmini/skills/`
- **4-tier context compression**: budget → snip → microcompact → auto-compact
- **5 permission modes**: default / plan / acceptEdits / bypassPermissions / dontAsk
- **Session persistence**: Auto-saves conversations, `--resume` to restore
- **Memory system**: Per-project storage with 4 types — user / feedback / project / reference
- **Tab completion**: Commands and skills in REPL
- **Extended thinking**: Supports Claude 4.6 adaptive thinking

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Set API key (choose one)
export ANTHROPIC_API_KEY=sk-ant-...
# Or use an OpenAI-compatible endpoint
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://your-api.com/v1

# Interactive mode
npm start

# One-shot mode
node dist/cli.js "fix the bug in src/app.ts"

# Dev mode (build + run immediately)
npm run dev
```

## CLI Options

```
Usage: claude-code-mini [options] [prompt]

Options:
  --yolo, -y          Skip all confirmation prompts
  --plan              Read-only mode, analyze without executing
  --accept-edits      Auto-approve file edits, still confirm dangerous commands
  --dont-ask          Auto-deny all confirmations (for CI)
  --thinking          Enable extended thinking (Anthropic only)
  --model, -m MODEL   Specify model
  --api-base URL      Use an OpenAI-compatible endpoint
  --resume            Resume the last session
  --max-cost USD      Cost ceiling in USD
  --max-turns N       Maximum number of agentic turns
  --help, -h          Show help
```

## REPL Commands

Available in interactive mode:

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model [tier] [name]` | Show/switch model or tier |
| `/clear` | Clear conversation history |
| `/cost` | Show token usage and cost |
| `/compact` | Manually compact the conversation |
| `/memory` | List saved memories |
| `/skills` | List available skills |
| `/<skill-name> [args]` | Invoke a skill |

Tab completion supported for commands and skill names.

## Three-Tier Model System

| Tier | Usage | Default Model |
|------|-------|---------------|
| **pro** | Main conversation, complex reasoning, general agent | `glm-5` |
| **lite** | Sub-agents, explore, plan | `minimax-m2.5` |
| **mini** | Compact summarization, quick queries | `kimi-k2.5` |

Configuration priority (high → low):
1. Runtime: `/model pro <name>` command
2. Environment: `MINI_CLAUDE_MODEL_PRO` / `_LITE` / `_MINI`
3. Config file: `.ccmini/settings.json`
4. Built-in defaults

## Project Structure

```
src/
├── cli.ts                    # Main entry point
├── cli/
│   ├── args.ts               # Argument parsing
│   ├── commands.ts           # Slash command registry
│   ├── config.ts             # API config resolution
│   └── repl.ts               # Interactive REPL loop
├── core/
│   ├── agent.ts              # Core Agent class (~1050 lines)
│   ├── agent-compression.ts  # Context compression pipeline
│   ├── agent-model.ts        # Model switch logic
│   ├── agent-retry.ts        # API retry logic
│   ├── model-tiers.ts        # Three-tier model system
│   └── prompt.ts             # System prompt builder
├── tools/
│   ├── definitions.ts        # Tool definitions (Anthropic format)
│   ├── dispatcher.ts         # Tool dispatch
│   ├── executors.ts          # Tool implementations
│   ├── permissions.ts        # Permission checks
│   └── tools.ts              # Module exports
├── ui/
│   └── ui.ts                 # Terminal UI
├── storage/
│   ├── session.ts            # Session persistence
│   └── memory.ts             # Memory system
├── extensions/
│   ├── skills.ts             # Skill discovery and execution
│   └── subagent.ts           # Sub-agent system
├── utils/
│   └── frontmatter.ts        # YAML frontmatter parser
└── templates/
    ├── system-prompt.md      # System prompt template
    └── plan-mode-prompt.md   # Plan mode template

.ccmini/
├── settings.json             # Project configuration
├── agents/                   # Custom agents
│   └── *.md
└── skills/                   # Custom skills
    └── */SKILL.md
```

## Architecture Overview

### Execution Flow

```
cli.ts → parseArgs() → resolveApiConfig() → new Agent() → chat() or runRepl()
```

### Agent Core Loop

```
User input → Compression pipeline → API call → Parse response
                                                       ├── Text → Print to terminal
                                                       └── Tool call → Permission check → Execute → Add result to history → Continue loop
```

### Context Compression Pipeline

A 4-tier progressive compression pipeline runs before each API call (first 3 tiers are zero API cost):

| Tier | Name | Trigger | Strategy |
|------|------|---------|----------|
| 1 | Budget | Context utilization > 50% | Truncate large tool results, keeping head and tail |
| 2 | Snip | Utilization exceeds threshold | Replace stale/duplicate tool results with placeholder |
| 3 | Microcompact | Idle for > 5 minutes | Aggressively clear old results (prompt cache is cold) |
| 4 | Auto-compact | Utilization > 85% | Summarize the entire conversation via API call |

## Extension System

### Custom Agents

Define in `.ccmini/agents/<name>.md`:

```yaml
---
name: test-writer
description: Agent for writing unit tests
allowed-tools: read_file, write_file, grep_search
model: lite
---

You are a specialized agent for writing unit tests. Write tests for the source code.
```

### Custom Skills

Define in `.ccmini/skills/<name>/SKILL.md`:

```yaml
---
name: commit
description: Generate Git commit message
user-invocable: true
mode: inline
---

Generate a commit message based on git diff. Format:
- First line: short summary
- Blank line
- Detailed description
```

Invoke via `/commit` in REPL.

### Permission Configuration

Configure in `.ccmini/settings.json`:

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_BASE_URL` | Custom Anthropic endpoint (optional) |
| `OPENAI_API_KEY` | OpenAI-compatible API key |
| `OPENAI_BASE_URL` | OpenAI-compatible endpoint |
| `MINI_CLAUDE_MODEL` | Override pro tier model |
| `MINI_CLAUDE_MODEL_PRO` | Override pro tier model |
| `MINI_CLAUDE_MODEL_LITE` | Override lite tier model |
| `MINI_CLAUDE_MODEL_MINI` | Override mini tier model |

## Usage Examples

```bash
# Basic usage
claude-code-mini "explain the architecture of this project"

# Skip confirmations, fully automatic
claude-code-mini --yolo "run all tests and fix failures"

# Read-only analysis mode
claude-code-mini --plan "how would you refactor this module?"

# Auto-approve edits
claude-code-mini --accept-edits "add error handling to api.ts"

# Set cost and turn limits
claude-code-mini --max-cost 0.50 --max-turns 20 "implement feature X"

# Use an OpenAI-compatible endpoint
OPENAI_API_KEY=sk-xxx claude-code-mini --api-base https://api.example.com/v1 --model gpt-4o "hello"

# Resume the last conversation
claude-code-mini --resume
```

## Dependencies

- `@anthropic-ai/sdk` — Anthropic API client
- `openai` — OpenAI API client
- `chalk` — Terminal colors
- `glob` — File pattern matching

## License

MIT
