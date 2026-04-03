# Claude Code Mini

English | [简体中文](README.md)

A minimal AI coding agent built from scratch of TypeScript, inspired by [Claude Code](https://claude.ai/code).

> Forked from [Windy3f3f3f3f/claude-code-from-scratch](https://github.com/Windy3f3f3f3f/claude-code-from-scratch), heavily modified.

## Features

- **Dual backend support**: Anthropic Claude (native) + any OpenAI-compatible API
- **7 built-in tools**: read\_file, write\_file, edit\_file, list\_files, grep\_search, run\_shell, skill
- **Sub-agent system**: Three built-in types — explore (read-only), plan (analysis), general (full tools) — plus custom agents
- **4-tier context compression**: budget → snip → microcompact → auto-compact, mirroring Claude Code's compression pipeline
- **5 permission modes**: default / plan / acceptEdits / bypassPermissions / dontAsk
- **Session persistence**: Auto-saves conversations, `--resume` to restore the last session
- **Memory system**: Per-project storage with 4 memory types — user / feedback / project / reference
- **Skill extensions**: Define reusable skill templates via `.claude/skills/`
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
Usage: mini-claude [options] [prompt]

Options:
  --yolo, -y          Skip all confirmation prompts
  --plan              Read-only mode, analyze without executing
  --accept-edits      Auto-approve file edits, still confirm dangerous commands
  --dont-ask          Auto-deny all confirmations (for CI)
  --thinking          Enable extended thinking (Anthropic only)
  --model, -m MODEL   Specify model (default: claude-opus-4-6)
  --api-base URL      Use an OpenAI-compatible endpoint
  --resume            Resume the last session
  --max-cost USD      Cost ceiling in USD
  --max-turns N       Maximum number of agentic turns
  --help, -h          Show help
```

## REPL Commands

Available in interactive mode:

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `/clear`               | Clear conversation history                  |
| `/cost`                | Show token usage and cost                   |
| `/compact`             | Manually compact the conversation           |
| `/memory`              | List saved memories                         |
| `/skills`              | List available skills                       |
| `/<skill-name> [args]` | Invoke a skill (e.g. `/commit "fix types"`) |

## Project Structure

```
src/
├── cli.ts                    # Main entry point
├── cli/
│   ├── args.ts               # Argument parsing
│   ├── config.ts             # API config resolution
│   └── repl.ts               # Interactive REPL loop
├── core/
│   ├── agent.ts              # Core Agent class (chat loop, tool execution)
│   ├── agent-compression.ts  # Context compression pipeline
│   ├── agent-model.ts        # Model configuration and selection
│   ├── agent-openai-tools.ts # OpenAI tool format conversion
│   ├── agent-retry.ts        # API retry logic
│   └── prompt.ts             # System prompt builder
├── tools/
│   ├── tools.ts              # Tools module entry
│   ├── definitions.ts        # Tool definitions (Anthropic format)
│   ├── dispatcher.ts         # Tool dispatch and execution
│   ├── executors.ts          # Concrete tool implementations
│   └── permissions.ts        # Permission checks and dangerous command detection
├── ui/
│   └── ui.ts                 # Terminal UI (colors, spinner, Markdown rendering)
├── storage/
│   ├── session.ts            # Session persistence
│   └── memory.ts             # Memory system
├── extensions/
│   ├── skills.ts             # Skill discovery and execution
│   └── subagent.ts           # Sub-agent system
├── utils/
│   └── frontmatter.ts        # YAML frontmatter parser
└── templates/
    └── system-prompt.md      # System prompt template
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

| Tier | Name         | Trigger                       | Strategy                                              |
| ---- | ------------ | ----------------------------- | ----------------------------------------------------- |
| 1    | Budget       | Context utilization > 50%     | Truncate large tool results, keeping head and tail    |
| 2    | Snip         | Utilization exceeds threshold | Replace stale/duplicate tool results with placeholder |
| 3    | Microcompact | Idle for > 5 minutes          | Aggressively clear old results (prompt cache is cold) |
| 4    | Auto-compact | Utilization > 85%             | Summarize the entire conversation via API call        |

### Dual Backend Support

The Agent maintains two separate message histories (`anthropicMessages` / `openaiMessages`), routing via the `useOpenAI` flag. Tool definitions use Anthropic's format as the canonical form and are converted to OpenAI format on-the-fly via `toOpenAITools()`.

## Extensions

### Custom Skills

Create `.claude/skills/<name>/SKILL.md` in your project root:

```yaml
---
name: my-skill
description: What this skill does
user-invocable: true
context: inline
---
Your skill prompt template goes here.
Use $ARGUMENTS or ${ARGUMENTS} for user-provided arguments.
```

Then invoke via `/my-skill args` in the REPL.

### Custom Agents

Define in `.claude/agents/<name>.md`:

```yaml
---
name: my-agent
description: What this agent does
allowed-tools: read_file, grep_search, list_files
---
Your agent's system prompt goes here.
```

### Permission Configuration

Configure in `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["read_file(src/**)", "run_shell(npm test)"],
    "deny": ["run_shell(rm -rf *)"]
  }
}
```

## Environment Variables

| Variable             | Description                          |
| -------------------- | ------------------------------------ |
| `ANTHROPIC_API_KEY`  | Anthropic API key                    |
| `ANTHROPIC_BASE_URL` | Custom Anthropic endpoint (optional) |
| `OPENAI_API_KEY`     | OpenAI-compatible API key            |
| `OPENAI_BASE_URL`    | OpenAI-compatible endpoint           |
| `MINI_CLAUDE_MODEL`  | Override default model               |

## Usage Examples

```bash
# Basic usage
mini-claude "explain the architecture of this project"

# Skip confirmations, fully automatic
mini-claude --yolo "run all tests and fix failures"

# Read-only analysis mode
mini-claude --plan "how would you refactor this module?"

# Auto-approve edits
mini-claude --accept-edits "add error handling to api.ts"

# Set cost and turn limits
mini-claude --max-cost 0.50 --max-turns 20 "implement feature X"

# Use an OpenAI-compatible endpoint
OPENAI_API_KEY=sk-xxx mini-claude --api-base https://aihubmix.com/v1 --model gpt-4o "hello"

# Resume the last conversation
mini-claude --resume
```

## Dependencies

- `@anthropic-ai/sdk` — Anthropic API client
- `openai` — OpenAI API client
- `chalk` — Terminal colors
- `glob` — File pattern matching

## License

MIT
