# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # tsc + copy templates to dist/
npm run dev            # build + run CLI interactively
claude-code-mini       # run compiled CLI (or npm start)
claude-code-mini --help
```

Tests use Vitest: `npm test` / `npm run test:watch`. Validate types with `npx tsc --noEmit`.

## Environment Variables

- `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` — Anthropic backend
- `OPENAI_API_KEY` + `OPENAI_BASE_URL` — OpenAI-compatible backend

Model configuration is done via `~/.ccmini/settings.json` or `.ccmini/settings.json` (project-level). Environment variables for model tiers are not supported.

## Architecture

A minimal TypeScript CLI agent (~3900 lines) that mirrors Claude Code's core architecture. ESM modules, strict mode, target ES2022.

### Entry Flow

`src/cli.ts` → `parseArgs()` → `resolveApiConfig()` → `initModelTiers()` → create `Agent` → one-shot `agent.chat(prompt)` or `runRepl(agent)`.

### Key Modules

| File | Lines | Description |
|------|-------|-------------|
| **`src/core/agent.ts`** | ~600 | Heart of the system. Orchestrates chat loop, streaming tool execution, token tracking, context compression, sub-agent forking. Delegates to MessageHandler backends. |
| **`src/backend/anthropic-backend.ts`** | ~296 | Anthropic backend: SSE event-based real-time streaming with immediate tool call yield |
| **`src/backend/openai-backend.ts`** | ~212 | OpenAI backend: incremental delta streaming with pending tool accumulation |
| **`src/backend/backend-types.ts`** | ~63 | MessageHandler interface, StreamChunk/StreamResult types |
| **`src/core/compress.ts`** | ~180 | 3-tier zero-cost compression pipeline (budget → snip → microcompact) |
| **`src/core/agent-strategies.ts`** | ~130 | Strategy pattern for agent and skill tool execution |
| **`src/tools/permissions.ts`** | ~287 | Permission modes, dangerous command detection, persistent rule management |
| **`src/extensions/subagent.ts`** | ~226 | Sub-agent system: 4 built-in types (explore, plan, general, compact) + custom agent discovery |
| **`src/storage/memory.ts`** | ~206 | Per-project memory system (user/feedback/project/reference) |
| **`src/storage/file-tracker.ts`** | ~201 | Per-turn file change tracking with revert support |
| **`src/core/model-tiers.ts`** | ~201 | Three-tier model hierarchy (pro/lite/mini) with priority chain configuration |
| **`src/storage/session.ts`** | ~64 | Session save/load persistence |
| **`src/cli/commands.ts`** | ~344 | REPL slash command registry, `/connect` interactive setup |
| **`src/cli/repl.ts`** | ~223 | Interactive REPL with tab completion and SIGINT handling |
| **`src/tools/definitions.ts`** | ~448 | 21 tool definitions with metadata (parallelSafe, idempotent) in Anthropic `input_schema` format |
| **`src/cli/config.ts`** | ~80 | API config resolution from settings files |
| **`src/core/agent-retry.ts`** | ~35 | Exponential backoff retry for 429/503/529/timeout |
| **`src/extensions/skills.ts`** | ~179 | Skill discovery from `.ccmini/skills/<name>/SKILL.md` |
| **`src/core/task-store.ts`** | ~132 | In-memory task management with change listeners |
| **`src/core/agent-model.ts`** | ~39 | Model context windows and thinking support detection |
| **`src/core/prompt.ts`** | ~84 | System prompt builder with dynamic sections |
| **`src/cli/args.ts`** | ~109 | CLI argument parsing |
| **`src/utils/frontmatter.ts`** | ~42 | YAML frontmatter parser/formatter |

### Project Structure

```
src/
├── cli.ts                    # Main entry point
├── cli/
│   ├── args.ts               # Argument parsing
│   ├── commands.ts           # Slash command registry + /connect flow
│   ├── config.ts             # API config resolution
│   └── repl.ts               # Interactive REPL loop
├── core/
│   ├── agent.ts              # Agent class (chat loop, tool execution)
│   ├── agent-model.ts        # Model context windows, thinking support
│   ├── agent-retry.ts        # API retry with backoff
│   ├── agent-strategies.ts   # Strategy pattern for agent/skill tools
│   ├── compress.ts           # Context compression pipeline
│   ├── model-tiers.ts        # Three-tier model system
│   ├── prompt.ts             # System prompt builder
│   └── task-store.ts         # In-memory task management
├── backend/
│   ├── backend-types.ts      # MessageHandler interface, StreamChunk/StreamResult
│   ├── anthropic-backend.ts  # Anthropic: SSE event-based real-time streaming
│   ├── openai-backend.ts     # OpenAI: incremental delta streaming
│   └── index.ts              # Module exports
├── tools/
│   ├── definitions.ts        # Tool definitions with metadata (Anthropic format)
│   ├── dispatcher.ts         # Tool dispatch and execution
│   ├── executors.ts          # Barrel export for executors
│   ├── executors/            # Concrete tool implementations
│   │   ├── index.ts          # Handler registry
│   │   ├── file-ops.ts       # read_file, write_file, edit_file
│   │   ├── search.ts         # list_files, grep_search
│   │   ├── shell.ts          # run_shell
│   │   ├── git.ts            # 9 Git tools
│   │   ├── web-search.ts     # web_search
│   │   └── tasks.ts          # task_create, task_update, task_list
│   ├── permissions.ts        # Permission checks + persistent rules
│   └── tools.ts              # Module exports
├── ui/
│   ├── index.ts              # Barrel export
│   ├── colors.ts             # Chalk color constants
│   ├── spinner.ts            # Loading animation
│   ├── markdown.ts           # Markdown rendering
│   ├── menu.ts               # Interactive menus
│   └── output.ts             # Output functions
├── storage/
│   ├── session.ts            # Session persistence
│   ├── memory.ts             # Memory system
│   └── file-tracker.ts       # File change tracking + revert
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
2. Config file: `.ccmini/settings.json` → `{ "models": { "pro": "...", ... } }`
3. Built-in defaults

### Context Compression Pipeline

4-tier pipeline before each API call (first 3 are zero-cost local operations):

1. **Budget** — Truncate large tool results (keep head+tail) when context utilization > 50%
2. **Snip** — Replace stale/duplicate tool results with placeholder when utilization > 60%
3. **Microcompact** — Aggressively clear old results when prompt cache is cold (idle > 5min)
4. **Auto-compact** — Full conversation summarization via API call when utilization > 85%

Each tier has separate Anthropic/OpenAI implementations due to different message formats.

### Permission System

5 modes: `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`.

Permission checks happen in `Agent` before each tool execution. Dangerous shell commands detected via regex patterns in `permissions.ts`.

Permission rules can be persisted to `.ccmini/settings.json`:

```json
{
  "permissions": {
    "allow": ["write_file(/path/to/project/*)", "run_shell(npm test*)"],
    "deny": ["run_shell(rm *)"]
  }
}
```

### Sub-agent Pattern

Sub-agents are isolated `Agent` instances with:
- Filtered tool sets (explore/plan: read-only; general: all except agent tool)
- Own message history
- Output captured to buffer (not printed)
- Tokens aggregated back to parent
- Permission mode always `bypassPermissions`
- Cannot recursively call agent/skill tools

Agent type → tier routing:
- `explore` → lite
- `plan` → lite
- `general` → pro
- `compact` → mini

Custom agents via `.ccmini/agents/<name>.md` with YAML frontmatter (`name`, `description`, `allowed-tools`, `model`).

### Streaming Architecture

Both backends implement `streamChunk()` as an `AsyncGenerator<StreamChunk>` that yields chunks in real-time:

**Anthropic** (`anthropic-backend.ts`): Iterates `MessageStream` SSE events directly:
- `content_block_start` → detect block type (text / tool_use / thinking)
- `content_block_delta` → yield text immediately, accumulate tool JSON args
- `content_block_stop` → yield completed `toolCall`, push to `rawAssistantContent`
- After iteration: `finalMessage()` for usage stats

**OpenAI** (`openai-backend.ts`): Iterates streamed deltas with `pendingTools` map:
- `delta.content` → yield text immediately
- `delta.tool_calls` → accumulate args by index, yield on index change
- After stream: flush remaining pending tools

**Consumer** (`agent.ts` `chatLoop`): Iterates `streamChunk()` and starts parallel-safe tool execution (`isParallelSafe && isIdempotent`) as soon as each `toolCall` arrives, without waiting for the full response.

### File Change Tracking

`file-tracker.ts` records all file modifications (write_file / edit_file) per turn. Supports:
- `/trace` — show all file changes by turn
- `/revert` — undo all file changes from the last turn
- Session-scoped, initialized per Agent instance

### REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model [tier] [name]` | Show/switch model or tier |
| `/clear` | Clear conversation history |
| `/compact` | Manually compact conversation |
| `/memory` | List saved memories |
| `/connect` | Interactively connect to an API provider |
| `/trace` | Show all file changes by turn |
| `/revert` | Revert the last turn's file changes |
| `/skills` | List available skills |
| `/<skill-name>` | Invoke a user-defined skill |

Tab completion supported for commands and skills (press Tab after `/`).

### Skill System

Skills are defined in `.ccmini/skills/<name>/SKILL.md` with YAML frontmatter:
- `name`, `description`, `user-invocable`, `context` (inline/fork), `allowed-tools`, `model`
- Two execution modes: `inline` (inject into conversation) and `fork` (run in sub-agent)
- Discovered from user-level (`~/.ccmini/skills/`) and project-level (`.ccmini/skills/`)

## Conventions

- All source uses ESM imports with explicit `.js` extensions (required by Node ESM resolution).
- Tool definitions follow Anthropic's `input_schema` format as the canonical form.
- The `Agent` class delegates to `MessageHandler` backends (AnthropicBackend / OpenAIBackend) for all API communication.
- Both backends implement true streaming via `streamChunk()` async generator — text yields in real-time, tool calls yield on content block completion.
- Config directory is `.ccmini/` (skills, agents, settings).
- Strategy pattern used for `agent` and `skill` tools via `agent-strategies.ts`.
- 21 built-in tools with metadata: `parallelSafe` and `idempotent` flags for automatic parallel execution optimization.
