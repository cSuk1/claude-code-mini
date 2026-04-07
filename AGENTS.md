# Codebase Guide for Claude Code - Mini

## Build, Lint & Test Commands

- `npm run build` - Compile TypeScript to `dist/` and copy templates
- `npm run dev` - Build and run interactively (REPL mode)
- `npm start` / `claude-code-mini` - Run compiled CLI
- `claude-code-mini --help` - Show CLI help flags
- `claude-code-mini --model <name>` - Use specific model
- `claude-code-mini "prompt"` - One-shot prompt mode (no REPL)
- `claude-code-mini --yolo` - Skip all confirmations (bypassPermissions)
- `claude-code-mini --plan` - Read-only plan mode
- `claude-code-mini --accept-edits` - Auto-approve file edits
- `claude-code-mini --dont-ask` - Auto-deny confirmations (CI mode)
- `claude-code-mini --resume` - Resume last session
- `claude-code-mini --connect` - Interactively configure API provider
- `npm test` - Run Vitest test suite
- `npm run test:watch` - Run tests in watch mode
- Validate types: `npx tsc --noEmit`

## Code Style & Conventions

### Language & Target
- TypeScript ES2022, strict mode, ESM modules
- All imports use explicit `.js` extensions (Node ESM requirement)
- Compile target: ES2022, module: ESNext (bundler resolver)

### Imports
```typescript
import { Agent } from "./core/agent.js";
import chalk from "chalk";
import type Anthropic from "@anthropic-ai/sdk";
```
- Order: ESM imports → type imports → third-party → local
- No namespace imports unless needed
- Always use `.js` extension even for local files

### Naming Conventions
- **Classes**: PascalCase (`Agent`, `CommandRegistry`, `TaskStore`)
- **Functions/Methods**: camelCase (`chatAnthropic`, `executeToolCall`)
- **Constants**: UPPER_SNAKE_CASE (`SNIP_THRESHOLD`, `MICROCOMPACT_IDLE_MS`)
- **Private members**: prefix with `_` (`_model`, `lastInputTokenCount`)
- **File names**: kebab-case for modules (`compress.ts`, `agent-model.ts`)

### Types & Interfaces
```typescript
interface AgentOptions {
  permissionMode?: PermissionMode;
  model?: string;
  [key: string]: any;
}

type ToolDef = Anthropic.Tool;
type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk";
```
- Prefer `interface` over `type` for object shapes
- Use union types for finite sets (`"default" | "plan"`)
- Type all function parameters; infer return types when obvious
- Use `any` sparingly; prefer `{ [key: string]: any }` for dynamic objects

### Error Handling
```typescript
try {
  await agent.chat(prompt);
} catch (e: any) {
  if (e.name === "AbortError" || e.message?.includes("aborted")) {
    // Already handled
  } else {
    printError(e.message);
  }
}
```
- Catch with `e: any` (TypeScript strictness)
- Distinguish `AbortError` for cancellations
- Use guard clauses (`if (...) return`)
- Always `throw` unexpected errors up
- Never silently ignore errors

### Tool Definitions
```typescript
export const toolDefinitions: ToolDefWithMeta[] = [{
  name: "read_file",
  description: "Read file contents with line numbers...",
  metadata: { category: "read", parallelSafe: true, idempotent: true },
  input_schema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "The path to the file" },
    },
    required: ["file_path"],
  },
}];
```
- Follow Anthropic `input_schema` format as canonical
- Include `metadata` with `category`, `parallelSafe`, `idempotent` flags
- `description` should be clear, concise, action-oriented
- `input_schema` properties need descriptive `description`
- `required` array lists mandatory fields

### Architecture Patterns

#### Backend Abstraction
- **MessageHandler**: Interface for backend implementations
- **AnthropicBackend**: Handles Anthropic API streaming (SSE events)
- **OpenAIBackend**: Handles OpenAI-compatible API streaming (deltas)
- Backend determines message format for tool results
- Both implement `streamChunk()` as `AsyncGenerator<StreamChunk>`

#### Strategy Pattern (`agent-strategies.ts`)
- `AgentStrategy`: Sub-agent execution via forked Agent instances
- `SkillStrategy`: Skill execution (inline injection or fork)
- `ToolStrategyRegistry`: Maps tool names to strategies

#### Compression Pipeline (`compress.ts`)
- 3 tiers: budget → snip → microcompact (zero API cost)
- Plus auto-compact (API-based summarization, triggered at > 85% utilization)
- Separate methods for Anthropic vs OpenAI message formats

#### Sub-Agent Isolation
- Forked `Agent` instances with filtered tool sets
- Own message history, isolated state
- Permission mode always `bypassPermissions` for sub-agents
- Output captured to buffer, tokens aggregated back to parent
- 4 built-in types: explore (read-only), plan (read-only), general (full tools), compact (no tools)

#### Tier Routing
- pro (main/general) → lite (explore/plan) → mini (compact)
- Based on `model-tiers.ts`, configurable via settings or `/model` command

#### Permission System
- Mode-aware checks (`default`, `plan`, `acceptEdits`, etc.)
- Dangerous command regex detection
- Persistent rules via `.ccmini/settings.json` with allow/deny lists
- Smart rule generation: compound commands (npm test*), file paths, wildcards

### Code Organization

```
src/
├── cli.ts                        # Main entry point
│
├── cli/                          # CLI
│   ├── args.ts                   # Argument parsing
│   ├── commands.ts               # Slash commands + /connect flow
│   ├── config.ts                 # API config resolution
│   └── repl.ts                   # Interactive REPL
│
├── core/                         # Core
│   ├── agent.ts                  # Agent class (chat loop, tool execution)
│   ├── agent-model.ts            # Model context windows, thinking support
│   ├── agent-retry.ts            # Retry logic (exponential backoff)
│   ├── agent-strategies.ts       # Strategy pattern for agent/skill tools
│   ├── compress.ts               # CompressionPipeline
│   ├── model-tiers.ts            # Tier routing
│   ├── prompt.ts                 # System prompt builder
│   └── task-store.ts             # Task state management
│
├── backend/                      # API backends
│   ├── backend-types.ts          # MessageHandler interface
│   ├── anthropic-backend.ts      # Anthropic implementation
│   ├── openai-backend.ts         # OpenAI implementation
│   └── index.ts                  # Barrel export
│
├── tools/                        # Tool system
│   ├── definitions.ts            # Tool schemas with metadata
│   ├── dispatcher.ts             # Tool dispatch
│   ├── executors.ts              # Barrel export
│   ├── executors/                # Tool implementations
│   │   ├── index.ts              # Handler registry
│   │   ├── file-ops.ts           # read_file, write_file, edit_file
│   │   ├── search.ts             # list_files, grep_search
│   │   ├── shell.ts              # run_shell
│   │   ├── git.ts                # 9 git tools
│   │   ├── web-search.ts         # web_search
│   │   └── tasks.ts              # task_create, task_update, task_list
│   ├── permissions.ts            # Permission rules + persistent policies
│   └── tools.ts                  # Barrel export
│
├── ui/                           # Terminal UI
│   ├── index.ts                  # Barrel export
│   ├── colors.ts                 # Chalk color constants
│   ├── spinner.ts                # Loading animation
│   ├── markdown.ts               # Markdown rendering
│   ├── menu.ts                   # Interactive menus
│   └── output.ts                 # Output functions
│
├── storage/                      # Persistence
│   ├── session.ts                # Session save/load
│   ├── memory.ts                 # Project memory (4 types)
│   └── file-tracker.ts           # File change tracking + revert
│
├── extensions/                   # Extensions
│   ├── skills.ts                 # Skill discovery and execution
│   └── subagent.ts               # Sub-agent config + custom agents
│
├── utils/
│   └── frontmatter.ts            # YAML frontmatter parser/formatter
│
└── templates/
    ├── system-prompt.md          # System prompt template
    └── plan-mode-prompt.md       # Plan mode template
```

### Console Output
- Use `chalk` via `ui/colors.ts` (`C.accent`, `C.muted`, etc.)
- Functions: `printInfo()`, `printError()`, `printWarning()`, `printDivider()`, `printConfirmation()`
- Spinners: `startSpinner()`, `stopSpinner()`, `updateSpinnerLabel()`
- Markdown: `flushMarkdown()`, `resetMarkdown()`
- Sub-agent: `printSubAgentStart()`, `printSubAgentEnd()`
- Tasks: `printTaskSummary()`, `printTokenUsage()`, `getTaskSpinnerLabel()`

### Files to Reference
- `src/core/agent.ts` - Agent class, chat loop
- `src/backend/anthropic-backend.ts` - Anthropic streaming
- `src/backend/openai-backend.ts` - OpenAI streaming
- `src/core/compress.ts` - Compression pipeline
- `src/core/agent-strategies.ts` - Agent/skill strategy pattern
- `src/tools/definitions.ts` - Tool schemas with metadata
- `src/tools/permissions.ts` - Permission modes and persistent rules
- `src/extensions/subagent.ts` - Sub-agent system and custom agents
- `src/extensions/skills.ts` - Skill discovery and execution
- `src/storage/file-tracker.ts` - File change tracking and revert
- `src/cli/repl.ts` - Interactive REPL

### Testing
- Vitest configured (`vitest.config.ts`)
- `npm test` - Run tests
- `npm run test:watch` - Watch mode
- `npm run test:coverage` - Coverage report
- Validate types: `npx tsc --noEmit`
