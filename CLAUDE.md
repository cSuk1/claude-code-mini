# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # tsc + copy templates to dist/
npm run dev            # build + run CLI interactively
npm start              # run compiled dist/cli.js
node dist/cli.js --help
```

No test framework is configured yet. Validate changes with `npx tsc --noEmit`.

## Environment Variables

- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` — Anthropic backend
- `OPENAI_API_KEY` + `OPENAI_BASE_URL` — OpenAI-compatible backend
- `MINI_CLAUDE_MODEL` — override pro tier model
- `MINI_CLAUDE_MODEL_PRO` / `_LITE` / `_MINI` — override specific tier models

## Architecture

A minimal TypeScript CLI agent (~3900 lines) that mirrors Claude Code's core architecture. ESM modules, strict mode, target ES2022.

### Entry Flow

`src/cli.ts` → `parseArgs()` → `resolveApiConfig()` → create `Agent` → one-shot `agent.chat(prompt)` or `runRepl(agent)`.

### Key Modules

| File | Lines | Description |
|------|-------|-------------|
| **`src/core/agent.ts`** | ~1050 | Heart of the system. Orchestrates chat loop, tool execution, token tracking, context compression, sub-agent forking. Maintains dual message histories for Anthropic/OpenAI. |
| **`src/ui/ui.ts`** | ~530 | Terminal UI: colors, spinners, Markdown rendering, progress display |
| **`src/tools/executors.ts`** | ~270 | Concrete implementations for all 7 built-in tools |
| **`src/extensions/subagent.ts`** | ~225 | Sub-agent system: 4 built-in types (explore, plan, general, compact) + custom agent discovery |
| **`src/core/model-tiers.ts`** | ~225 | Three-tier model hierarchy (pro/lite/mini) with priority chain configuration |
| **`src/storage/memory.ts`** | ~205 | Per-project memory system (user/feedback/project/reference) |
| **`src/cli/commands.ts`** | ~200 | REPL slash command registry (/help, /model, /clear, etc.) |
| **`src/extensions/skills.ts`** | ~180 | Skill discovery from `.ccmini/skills/<name>/SKILL.md` |
| **`src/tools/definitions.ts`** | ~175 | Tool definitions in Anthropic `input_schema` format |
| **`src/tools/permissions.ts`** | ~175 | Permission modes and dangerous command detection |
| **`src/cli/repl.ts`** | ~170 | Interactive REPL with tab completion and SIGINT handling |
| **`src/core/prompt.ts`** | ~85 | System prompt builder with dynamic sections |

### Project Structure

```
src/
├── cli.ts                    # Main entry point
├── cli/
│   ├── args.ts               # Argument parsing
│   ├── commands.ts           # Slash command registry
│   ├── config.ts             # API config resolution
│   └── repl.ts               # Interactive REPL loop
├── core/
│   ├── agent.ts              # Agent class (chat loop, tool execution)
│   ├── agent-compression.ts  # Context compression pipeline
│   ├── agent-model.ts        # Model switch logic
│   ├── agent-retry.ts        # API retry with backoff
│   ├── model-tiers.ts        # Three-tier model system
│   └── prompt.ts             # System prompt builder
├── tools/
│   ├── definitions.ts        # Tool definitions (Anthropic format)
│   ├── dispatcher.ts         # Tool dispatch and execution
│   ├── executors.ts          # Concrete tool implementations
│   ├── permissions.ts        # Permission checks
│   └── tools.ts              # Module exports
├── ui/
│   └── ui.ts                 # Terminal UI utilities
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
```

### Model Tier System

Three-tier hierarchy for cost optimization:

| Tier | Usage | Default Model |
|------|-------|---------------|
| **pro** | Main conversation, complex reasoning, general agent | `glm-5` |
| **lite** | Sub-agents, explore, plan | `minimax-m2.5` |
| **mini** | Compact summarization, quick queries | `kimi-k2.5` |

Configuration priority (high → low):
1. Runtime: `/model pro <name>` command
2. Environment: `MINI_CLAUDE_MODEL_PRO` / `_LITE` / `_MINI`
3. Config file: `.ccmini/settings.json` → `{ "models": { "pro": "...", ... } }`
4. Built-in defaults

### Context Compression Pipeline

4-tier pipeline before each API call (first 3 are zero-cost local operations):

1. **Budget** — Truncate large tool results (keep head+tail) when context utilization > 50%
2. **Snip** — Replace stale/duplicate tool results with placeholder when utilization exceeds threshold
3. **Microcompact** — Aggressively clear old results when prompt cache is cold (idle > 5min)
4. **Auto-compact** — Full conversation summarization via API call when utilization > 85%

Each tier has separate Anthropic/OpenAI implementations due to different message formats.

### Permission System

5 modes: `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`.

Permission checks happen in `Agent` before each tool execution. Dangerous shell commands detected via regex patterns in `permissions.ts`.

Settings configured via `.ccmini/settings.json`:

```json
{
  "permissionMode": "default",
  "models": { "pro": "...", "lite": "...", "mini": "..." },
  "tools": { "read_file": "allow", "write_file": "ask", "run_shell": "ask" }
}
```

### Sub-agent Pattern

Sub-agents are isolated `Agent` instances with:
- Filtered tool sets (explore/plan: read-only; general: all except agent tool)
- Own message history
- Output captured to buffer (not printed)
- Tokens aggregated back to parent
- Cannot recursively call agent/skill tools

Agent type → tier routing:
- `explore` → lite
- `plan` → lite
- `general` → pro
- `compact` → mini

### REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model [tier] [name]` | Show/switch model or tier |
| `/clear` | Clear conversation history |
| `/cost` | Show token usage and cost |
| `/compact` | Manually compact conversation |
| `/memory` | List saved memories |
| `/skills` | List available skills |

Tab completion supported for commands and skills.

## Conventions

- All source uses ESM imports with explicit `.js` extensions (required by Node ESM resolution).
- Tool definitions follow Anthropic's `input_schema` format as the canonical form.
- The `Agent` class has parallel method pairs for both backends (e.g., `chatAnthropic()`/`chatOpenAI()`).
- Config directory is `.ccmini/` (skills, agents, settings).
